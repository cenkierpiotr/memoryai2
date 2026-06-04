/**
 * Memory Deduplication Worker
 *
 * Finds near-identical memories (cosine similarity >= 0.95) and merges them:
 * - Keeps the one with higher importance / more access
 * - Tags the duplicate as superseded via memory_links
 * - Demotes the duplicate to cold tier
 *
 * Runs weekly. Safe to run manually via POST /v1/admin/deduplicate.
 */

import { query } from '../db/pool.js';
import { contextBundleService } from '../services/context-bundle.service.js';

interface DuplicatePair {
  id_a: string;
  id_b: string;
  content_a: string;
  content_b: string;
  similarity: number;
  category_a: string;
  category_b: string;
}

async function mergePair(pair: DuplicatePair, userId: string): Promise<void> {
  // Determine which to keep: higher importance wins; on tie, keep older (more established)
  const [memA, memB] = await Promise.all([
    query<{ importance: number; access_count: number; tier: string }>(
      'SELECT importance, access_count, tier FROM memories WHERE id = $1',
      [pair.id_a]
    ),
    query<{ importance: number; access_count: number; tier: string }>(
      'SELECT importance, access_count, tier FROM memories WHERE id = $1',
      [pair.id_b]
    ),
  ]);

  if (!memA.rows[0] || !memB.rows[0]) return;

  const scoreA = memA.rows[0].importance + memA.rows[0].access_count * 0.01;
  const scoreB = memB.rows[0].importance + memB.rows[0].access_count * 0.01;

  const [keepId, dropId] = scoreA >= scoreB
    ? [pair.id_a, pair.id_b]
    : [pair.id_b, pair.id_a];

  // Don't demote pinned memories
  const pinCheck = await query<{ pinned: boolean }>(
    'SELECT pinned FROM memories WHERE id = $1',
    [dropId]
  );
  if (pinCheck.rows[0]?.pinned) return;

  // Link: kept memory supersedes the duplicate
  await query(
    `INSERT INTO memory_links (source_id, target_memory_id, link_type)
     VALUES ($1, $2, 'supersedes') ON CONFLICT DO NOTHING`,
    [keepId, dropId]
  );

  // Demote duplicate to cold
  await query(
    `UPDATE memories SET tier = 'cold', metadata = metadata || '{"deduplicated": true}'::jsonb
     WHERE id = $1`,
    [dropId]
  );
}

export async function runDeduplication(userId: string): Promise<{ pairs_merged: number }> {
  const pairs = await query<DuplicatePair>(
    'SELECT * FROM find_duplicate_memories($1, 0.95, 100)',
    [userId]
  );

  let merged = 0;
  for (const pair of pairs.rows) {
    await mergePair(pair, userId).catch((err: Error) => {
      process.stderr.write(`[dedup] merge failed for ${pair.id_a}/${pair.id_b}: ${err.message}\n`);
    });
    merged++;
  }

  if (merged > 0) {
    contextBundleService.invalidate(userId).catch(() => {});
  }

  return { pairs_merged: merged };
}

// ── Scheduled weekly runner ─────────────────────────────────

let dedupInterval: NodeJS.Timeout | null = null;

export async function scheduleDeduplication(): Promise<void> {
  async function check() {
    try {
      // Run for all users with memories
      const users = await query<{ id: string }>(
        `SELECT user_id AS id FROM memories WHERE tier != 'cold' GROUP BY user_id HAVING COUNT(*) > 20`
      );
      for (const user of users.rows) {
        const result = await runDeduplication(user.id);
        if (result.pairs_merged > 0) {
          process.stderr.write(`[dedup] merged ${result.pairs_merged} pairs for user ${user.id}\n`);
        }
      }
    } catch (err) {
      process.stderr.write(`[dedup] scheduled run failed: ${(err as Error).message}\n`);
    }
  }

  // Run once after startup (with delay), then weekly
  setTimeout(check, 5 * 60 * 1000); // 5 min after start
  dedupInterval = setInterval(check, 7 * 24 * 60 * 60 * 1000); // weekly
}

export function stopDeduplication(): void {
  if (dedupInterval) {
    clearInterval(dedupInterval);
    dedupInterval = null;
  }
}
