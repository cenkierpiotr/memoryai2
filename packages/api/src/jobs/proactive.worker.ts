/**
 * Proactive Conflict-Detection Worker
 *
 * Runs after every distillation session.
 * For each newly created memory it finds semantically similar existing memories
 * (cosine similarity > 0.85) and asks the LLM whether they contradict each other.
 * Detected conflicts are stored as a special memory (type=fact, tag=conflict) and
 * optionally reported via a webhook.
 */

import { Worker, type Job } from 'bullmq';
import { connection, type ProactiveCheckJob } from './proactive-queue.js';
import { memoryService } from '../services/memory.service.js';
import { embeddingService } from '../services/embedding.service.js';
import { callLLM } from '../utils/llm.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import type { Memory } from '@memoryai/shared';

// ── Conflict detection threshold ────────────────────────────

/** Cosine similarity threshold above which two memories are candidates for comparison */
const CONFLICT_SIMILARITY_THRESHOLD = 0.85;

// ── LLM prompt ──────────────────────────────────────────────

const CONFLICT_PROMPT = (a: string, b: string) => `You are a memory conflict detector. Determine whether these two memories are directly contradictory.

Memory A: "${a}"
Memory B: "${b}"

Memories are contradictory if they assert opposing facts about the same subject.
Differences in detail, specificity, or temporal context alone are NOT contradictions.

Return ONLY valid JSON, nothing else:
{
  "conflict": true | false,
  "reason": "One sentence explanation"
}`;

interface ConflictLLMResponse {
  conflict: boolean;
  reason: string;
}

// ── Semantic neighbour search ────────────────────────────────

interface SimilarMemoryRow {
  id: string;
  content: string;
  similarity: number;
}

async function findSimilarMemories(
  userId: string,
  embedding: number[],
  excludeId: string,
  limit = 5,
): Promise<SimilarMemoryRow[]> {
  const vectorLiteral = embeddingService.toVectorLiteral(embedding);

  const res = await query<SimilarMemoryRow>(
    `SELECT id, content,
            1 - (embedding <=> $1::vector) AS similarity
     FROM memories
     WHERE user_id = $2
       AND id != $3
       AND tier != 'cold'
       AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [vectorLiteral, userId, excludeId, limit],
  );

  return res.rows.filter(r => r.similarity >= CONFLICT_SIMILARITY_THRESHOLD);
}

// ── Conflict storage ─────────────────────────────────────────

/**
 * Store a detected conflict as a memory with type=fact, tag=conflict+needs_review.
 * Also records an entry in memory_links (contradicts) between the two memories.
 */
async function storeConflict(
  userId: string,
  memoryA: Memory,
  memoryBId: string,
  memoryBContent: string,
  reason: string,
): Promise<void> {
  const conflictContent =
    `CONFLICT: "${memoryA.content.slice(0, 100)}" vs "${memoryBContent.slice(0, 100)}" — ${reason}`.slice(0, 500);

  const conflictMemory = await memoryService.create(userId, {
    content: conflictContent,
    type: 'fact',
    tier: 'hot',
    category: 'general',
    importance: 0.8,
    tags: ['conflict', 'needs_review'],
    metadata: {
      conflict_memory_a: memoryA.id,
      conflict_memory_b: memoryBId,
      reason,
    },
  });

  // Link the two conflicting memories
  await query(
    `INSERT INTO memory_links (source_id, target_memory_id, link_type)
     VALUES ($1, $2, 'contradicts')
     ON CONFLICT DO NOTHING`,
    [memoryA.id, memoryBId],
  );

  // Fire optional webhook
  const webhookUrl = config.proactive.webhookUrl;
  if (webhookUrl) {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'conflict_detected',
        conflict_memory_id: conflictMemory.id,
        memory_a: { id: memoryA.id, content: memoryA.content },
        memory_b: { id: memoryBId, content: memoryBContent },
        reason,
        detected_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((err: Error) => {
      logger.error('proactive-webhook', `Webhook delivery failed: ${err.message}`);
    });
  }
}

// ── Per-memory conflict check ────────────────────────────────

async function checkMemoryForConflicts(userId: string, memId: string): Promise<number> {
  const mem = await memoryService.findById(userId, memId);
  if (!mem || !mem.content) return 0;

  // Re-embed on the fly — embedding is already stored; use it directly if possible
  const embedding = await embeddingService.embed(mem.content);
  const similar = await findSimilarMemories(userId, embedding, memId);

  if (similar.length === 0) return 0;

  let conflictsFound = 0;

  for (const candidate of similar) {
    let parsed: ConflictLLMResponse;
    try {
      const raw = await callLLM(CONFLICT_PROMPT(mem.content, candidate.content), 30_000);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) continue;
      parsed = JSON.parse(match[0]) as ConflictLLMResponse;
    } catch {
      continue; // Skip on LLM/parse error
    }

    if (parsed.conflict) {
      await storeConflict(userId, mem, candidate.id, candidate.content, parsed.reason ?? 'Conflict detected');
      conflictsFound++;
    }
  }

  return conflictsFound;
}

// ── Worker ───────────────────────────────────────────────────

export function startProactiveWorker(): Worker<ProactiveCheckJob> {
  const worker = new Worker<ProactiveCheckJob>(
    'proactive-check',
    async (job: Job<ProactiveCheckJob>) => {
      const { newMemoryIds, userId, sessionId } = job.data;

      let totalConflicts = 0;

      for (const memId of newMemoryIds) {
        try {
          const found = await checkMemoryForConflicts(userId, memId);
          totalConflicts += found;
        } catch (err) {
          logger.error('proactive', `Conflict check failed for memory ${memId}: ${(err as Error).message}`);
        }
      }

      if (totalConflicts > 0) {
        logger.info('proactive', `Session ${sessionId}: detected ${totalConflicts} conflict(s) from ${newMemoryIds.length} new memories`);
      }

      return { conflictsDetected: totalConflicts };
    },
    {
      connection,
      concurrency: 1, // Sequential to avoid race conditions on conflict storage
    },
  );

  worker.on('failed', (_job, err) => {
    logger.error('proactive', `Worker job failed: ${err.message}`);
  });

  return worker;
}
