/**
 * Background distillation worker
 *
 * After a session closes, this worker analyzes the conversation
 * and extracts persistent memories using a configured LLM.
 */

import { Worker, type Job } from 'bullmq';
import { connection, addDistillationJob, type DistillationJob } from './distillation.queue.js';
import { addProactiveCheckJob } from './proactive-queue.js';
import { sessionService } from '../services/session.service.js';
import { memoryService } from '../services/memory.service.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { callLLMWithFallback } from '../utils/llm.js';
import { entityService } from '../services/entity.service.js';
import { logger } from '../utils/logger.js';
import type { CreateMemoryDto, MemoryType, MemoryTier, MemoryCategory } from '@memoryai/shared';

// ── Distillation Logic ──────────────────────────────────────

const DISTILLATION_PROMPT = (conversation: string) => `You are a memory extraction system. Analyze this conversation and extract important facts, decisions, and entities for future sessions.

CONVERSATION:
${conversation}

Return ONLY valid JSON, no other text, no markdown.

Format:
{
  "memories": [
    {
      "content": "Concise self-contained fact (max 150 chars)",
      "type": "fact|decision|preference|instruction|entity_relation|summary",
      "tier": "core|hot|warm",
      "category": "user_profile|meta_instructions|active_project|technical_stack|preferences|workflow|domain_knowledge|decisions|constraints|relationships|infrastructure|general",
      "importance": 0.0-1.0
    }
  ],
  "entities": [
    {
      "name": "Entity name (person, project, company, tool, server)",
      "type": "person|project|company|tool|concept|place|other",
      "facts": ["Short fact about this entity (servers/infrastructure → tool)"]
    }
  ]
}

=== MEMORY RULES ===
- content: max 150 chars, dense, self-contained (reader has no prior context)
- Maximum 15 memories total
- Skip greetings, pleasantries, trivial chit-chat
- CRITICAL: Write content in the SAME language as the conversation (Polish→Polish, English→English)
- Polish decision: "Zdecydowano X zamiast Y — powód", preference: "Preferuje X nad Y", instruction: "Zawsze X kiedy Y"
- English decision: "Chose X over Y — reason", preference: "Prefers X over Y", instruction: "Always X when Y"

=== TIER RULES ===
- core: permanent user identity, standing rules that NEVER change ("always use TypeScript", "user is senior dev")
- hot: active project details, recent decisions, current tasks (last 1-4 weeks)
- warm: general facts, past projects, background knowledge

=== IMPORTANCE RULES ===
- 0.9-1.0: critical standing rules, security constraints, irreversible decisions
- 0.7-0.8: important project facts, technology choices, key decisions
- 0.5-0.6: useful context, workflow details, preferences
- 0.3-0.4: minor details, temporary state

=== CATEGORY RULES (pick the MOST specific — use 'general' ONLY if nothing fits) ===
- user_profile: who the user is, their role, skills, background
- meta_instructions: rules for the AI assistant behavior ("always do X", "never do Y")
- active_project: current project status, tasks, next steps, blockers
- technical_stack: languages, frameworks, libraries, versions, tools used
- decisions: architectural or product decisions with rationale
- preferences: user likes/dislikes, style preferences, chosen approaches
- workflow: how the user works, processes, git flow, deployment process
- domain_knowledge: business logic, domain-specific facts, industry knowledge
- constraints: hard limits, deadlines, compliance requirements, resource limits
- relationships: team members, clients, stakeholders
- infrastructure: servers, cloud, Docker, networking, environments
- general: LAST RESORT — only if the fact genuinely spans multiple categories or fits none

=== ENTITY RULES ===
- Extract named things: projects, people, servers, tools, companies
- Maximum 5 entities per session
- facts: 1-3 short facts per entity, max 100 chars each
- Skip generic entities (e.g. "the user", "Claude")`;

interface DistillationResult {
  memories: Array<{
    content: string;
    type: string;
    tier?: string;
    category?: string;
    importance: number;
  }>;
  entities?: Array<{
    name: string;
    type: string;
    facts: string[];
  }>;
}

const VALID_TYPES: MemoryType[] = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'];
const VALID_TIERS: MemoryTier[] = ['core', 'hot', 'warm', 'cold'];
const VALID_CATEGORIES: MemoryCategory[] = [
  'user_profile','meta_instructions','active_project','technical_stack',
  'preferences','workflow','domain_knowledge','decisions','constraints',
  'relationships','temporal','archive','infrastructure','general',
];
const VALID_ENTITY_TYPES = ['person', 'project', 'company', 'tool', 'concept', 'place', 'other'] as const;

async function distillSession(sessionId: string, userId: string): Promise<number> {
  const messages = await sessionService.getMessages(userId, sessionId, 200);
  if (messages.length < 2) return 0;

  const conversation = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const rawResponse = await callLLMWithFallback(DISTILLATION_PROMPT(conversation));

  let result: DistillationResult;
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    result = JSON.parse(jsonMatch[0]) as DistillationResult;
  } catch {
    // Fallback: save a basic summary
    result = {
      memories: [{
        content: `Session on ${new Date().toLocaleDateString()}: ${messages.length} messages exchanged.`,
        type: 'summary',
        importance: 0.3,
      }],
    };
  }

  const session = await sessionService.findByIdAny(sessionId);
  const dtos: CreateMemoryDto[] = result.memories
    .filter(m => m.content?.length > 10)
    .slice(0, 15)
    .map(m => ({
      content: m.content.slice(0, 500),
      type: VALID_TYPES.includes(m.type as MemoryType) ? (m.type as MemoryType) : 'fact',
      tier: VALID_TIERS.includes(m.tier as MemoryTier) ? (m.tier as MemoryTier) : 'warm',
      category: VALID_CATEGORIES.includes(m.category as MemoryCategory) ? (m.category as MemoryCategory) : 'general',
      importance: Math.max(0, Math.min(1, m.importance ?? 0.5)),
      session_id: sessionId,
      project_id: session?.project_id,
    }));

  let memoriesCreated = 0;
  if (dtos.length > 0) {
    const saved = await memoryService.createBatch(userId, dtos);
    memoriesCreated = saved.length;
    const newIds = saved.map(m => m.id);
    addProactiveCheckJob({ newMemoryIds: newIds, userId, sessionId }).catch((err: Error) => {
      logger.error('distillation', `Failed to enqueue proactive check: ${err.message}`);
    });
  }

  // Extract and upsert entities
  if (result.entities && result.entities.length > 0) {
    const entitiesSlice = result.entities.slice(0, 5);
    await Promise.allSettled(
      entitiesSlice
        .filter(e => e.name?.length > 1 && VALID_ENTITY_TYPES.includes(e.type as typeof VALID_ENTITY_TYPES[number]))
        .map(e =>
          entityService.upsert(userId, {
            name: e.name.slice(0, 100),
            type: e.type as typeof VALID_ENTITY_TYPES[number],
            facts: (e.facts ?? []).slice(0, 3).map(f => ({ content: f.slice(0, 100) })),
            project_id: session?.project_id,
          })
        )
    );
  }

  return memoriesCreated;
}

// ── Worker ──────────────────────────────────────────────────

export function startDistillationWorker(): Worker<DistillationJob> {
  const worker = new Worker<DistillationJob>(
    'distillation',
    async (job: Job<DistillationJob>) => {
      const { sessionId, userId } = job.data;

      // Upsert job record — handles retries and crash recovery correctly
      await query(
        `INSERT INTO distillation_jobs (session_id, user_id, status, started_at)
         VALUES ($1, $2, 'running', NOW())
         ON CONFLICT (session_id) DO UPDATE SET
           status = 'running',
           started_at = NOW(),
           error = NULL
         WHERE distillation_jobs.status != 'done'`,
        [sessionId, userId]
      );

      const memoriesCreated = await distillSession(sessionId, userId);
      await sessionService.markDistilled(sessionId, memoriesCreated);

      return { memoriesCreated };
    },
    {
      connection,
      concurrency: 2,
    }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error('distillation', `Job failed for session ${job.data.sessionId}: ${err.message}`);
    await query(
      `UPDATE distillation_jobs SET status = 'failed', error = $1, finished_at = NOW()
       WHERE session_id = $2 AND status = 'running'`,
      [err.message.slice(0, 500), job.data.sessionId]
    );
  });

  return worker;
}

// ── Periodic stale session checker ─────────────────────────

let staleCheckInterval: NodeJS.Timeout | null = null;

export async function scheduleStaleSessionCheck(): Promise<void> {
  const { distillationQueue } = await import('./distillation.queue.js');

  async function check() {
    try {
      const staleSessions = await sessionService.findStaleForDistillation(
        config.distillation.inactivityMinutes
      );
      for (const session of staleSessions) {
        await addDistillationJob({ sessionId: session.id, userId: session.user_id });
      }
    } catch (err) {
      logger.error('distillation', `Stale session check failed: ${(err as Error).message}`);
    }
  }

  await check();
  staleCheckInterval = setInterval(check, 60_000);
}

export function stopStaleSessionCheck(): void {
  if (staleCheckInterval) {
    clearInterval(staleCheckInterval);
    staleCheckInterval = null;
  }
}
