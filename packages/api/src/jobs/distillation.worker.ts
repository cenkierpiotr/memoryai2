/**
 * Background distillation worker
 *
 * After a session closes, this worker analyzes the conversation
 * and extracts persistent memories using a configured LLM.
 */

import { Worker, type Job } from 'bullmq';
import { connection, type DistillationJob } from './distillation.queue.js';
import { sessionService } from '../services/session.service.js';
import { memoryService } from '../services/memory.service.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import type { CreateMemoryDto, MemoryType, MemoryTier, MemoryCategory } from '@memoryai/shared';

// ── LLM Providers ───────────────────────────────────────────

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${config.distillation.ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.distillation.model,
      prompt,
      stream: false,
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama distillation failed: ${res.status}`);
  const data = await res.json() as { response: string };
  return data.response;
}

async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.distillation.model}:generateContent?key=${config.distillation.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini distillation failed: ${res.status}`);
  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0]?.content.parts[0]?.text ?? '';
}

async function callOpenAI(prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.distillation.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.distillation.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI distillation failed: ${res.status}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? '';
}

async function callAnthropic(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.distillation.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.distillation.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic distillation failed: ${res.status}`);
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? '';
}

async function callLLM(prompt: string): Promise<string> {
  switch (config.distillation.provider) {
    case 'gemini': return callGemini(prompt);
    case 'openai': return callOpenAI(prompt);
    case 'anthropic': return callAnthropic(prompt);
    default: return callOllama(prompt);
  }
}

// ── Distillation Logic ──────────────────────────────────────

const DISTILLATION_PROMPT = (conversation: string) => `You are a memory extraction system. Analyze this conversation and extract important information for future sessions.

CONVERSATION:
${conversation}

Return ONLY valid JSON, no other text.

Format:
{
  "memories": [
    {
      "content": "Concise self-contained fact (max 150 chars)",
      "type": "fact|decision|preference|instruction|entity_relation|summary",
      "tier": "core|hot|warm",
      "category": "user_profile|meta_instructions|active_project|technical_stack|preferences|workflow|domain_knowledge|decisions|constraints|relationships|temporal|general",
      "importance": 0.0-1.0
    }
  ]
}

Rules:
- content: max 150 characters, dense and self-contained. Omit filler words.
- tier: core=user identity/standing rules, hot=active project/recent decisions, warm=general facts
- category: choose the most specific match from the enum list
- importance: 0.9-1.0=critical rules/decisions, 0.7-0.8=important facts, 0.5-0.6=context, 0.3-0.4=minor
- Skip greetings, pleasantries, and trivial content
- Maximum 15 memories per session
- Write content in the same language as the conversation
- Decision pattern: "Chose X over Y — reason"
- Preference pattern: "Prefers X over Y"
- Instruction pattern: "Always X when Y"
- Include one summary memory if conversation covered multiple topics`;

const VALID_TYPES: MemoryType[] = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'];
const VALID_TIERS: MemoryTier[] = ['core', 'hot', 'warm', 'cold'];
const VALID_CATEGORIES: MemoryCategory[] = [
  'user_profile','meta_instructions','active_project','technical_stack',
  'preferences','workflow','domain_knowledge','decisions','constraints',
  'relationships','temporal','archive','general',
];

interface DistillationResult {
  memories: Array<{
    content: string;
    type: string;
    tier?: string;
    category?: string;
    importance: number;
  }>;
}

async function distillSession(sessionId: string, userId: string): Promise<number> {
  const messages = await sessionService.getMessages(sessionId, 200);
  if (messages.length < 2) return 0;

  const conversation = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const rawResponse = await callLLM(DISTILLATION_PROMPT(conversation));

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

  if (dtos.length > 0) {
    await memoryService.createBatch(userId, dtos);
  }

  return dtos.length;
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
    process.stderr.write(`[distillation] Job failed for session ${job.data.sessionId}: ${err.message}\n`);
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
        await distillationQueue.add({ sessionId: session.id, userId: session.user_id });
      }
    } catch (err) {
      process.stderr.write(`[distillation] Stale session check failed: ${(err as Error).message}\n`);
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
