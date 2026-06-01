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
import type { CreateMemoryDto, MemoryType } from '@memoryai/shared';

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

const DISTILLATION_PROMPT = (conversation: string) => `You are a memory extraction system. Analyze this conversation and extract important information that should be remembered for future sessions.

CONVERSATION:
${conversation}

Extract memories in JSON format. Return ONLY valid JSON, no other text.

Format:
{
  "memories": [
    {
      "content": "Complete, self-contained statement of the fact/decision/preference",
      "type": "fact|decision|preference|instruction|entity_relation|summary",
      "importance": 0.0-1.0
    }
  ]
}

Rules:
- Each memory must be self-contained (understandable without the conversation)
- Use high importance (0.8-1.0) for: decisions made, instructions given, critical preferences
- Use medium importance (0.5-0.7) for: general facts, background info
- Use low importance (0.3-0.4) for: minor details
- Skip pleasantries, greetings, and trivial content
- Maximum 20 memories per session
- Write in the same language as the conversation
- For decisions: "Decided to use X instead of Y because Z"
- For preferences: "User prefers X over Y"
- For instructions: "Always do X when Y"
- Include a summary type memory if conversation was substantial`;

interface DistillationResult {
  memories: Array<{
    content: string;
    type: string;
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
    .slice(0, 20)
    .map(m => ({
      content: m.content,
      type: (m.type as MemoryType) || 'fact',
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

      // Mark job as running
      await query(
        `INSERT INTO distillation_jobs (session_id, user_id, status, started_at)
         VALUES ($1, $2, 'running', NOW())
         ON CONFLICT DO NOTHING`,
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
    await query(
      `UPDATE distillation_jobs SET status = 'failed', error = $1, finished_at = NOW()
       WHERE session_id = $2 AND status = 'running'`,
      [err.message, job.data.sessionId]
    );
  });

  return worker;
}

// ── Periodic stale session checker ─────────────────────────

export async function scheduleStaleSessionCheck(): Promise<NodeJS.Timeout> {
  const { distillationQueue } = await import('./distillation.queue.js');

  async function check() {
    const staleSessions = await sessionService.findStaleForDistillation(
      config.distillation.inactivityMinutes
    );
    for (const session of staleSessions) {
      await distillationQueue.add({ sessionId: session.id, userId: session.user_id });
    }
  }

  await check();
  return setInterval(check, 60_000);
}
