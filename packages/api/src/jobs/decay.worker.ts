/**
 * Memory Decay Worker
 *
 * Implements natural forgetting by demoting memories based on last access time:
 *
 *   hot  → warm : not accessed in 14 days
 *   warm → cold : not accessed in 60 days AND importance < 0.7
 *
 * Cold tier is excluded from default search (include_cold=false).
 * Accessing a cold memory via memory_search promotes it back to warm automatically
 * (touch_memories handles the reverse promotion).
 *
 * Runs weekly. Safe to trigger manually via POST /v1/admin/decay.
 */

import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';

const HOT_TO_WARM_DAYS  = parseInt(process.env.DECAY_HOT_DAYS  ?? '14', 10);
const WARM_TO_COLD_DAYS = parseInt(process.env.DECAY_COLD_DAYS ?? '60', 10);
const COLD_IMPORTANCE_THRESHOLD = parseFloat(process.env.DECAY_COLD_IMPORTANCE ?? '0.7');

interface DecayResult {
  userId: string;
  hotToWarm: number;
  warmToCold: number;
}

export async function runDecay(): Promise<DecayResult[]> {
  // Get all distinct user IDs that have memories
  const usersResult = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM memories WHERE tier IN ('hot','warm')`,
    []
  );

  const results: DecayResult[] = [];

  for (const { user_id } of usersResult.rows) {
    // hot → warm: no access in HOT_TO_WARM_DAYS
    const hotResult = await query<{ count: string }>(
      `UPDATE memories
       SET tier = 'warm', updated_at = NOW()
       WHERE user_id = $1
         AND tier = 'hot'
         AND tier != 'core'
         AND last_accessed < NOW() - ($2 || ' days')::interval
       RETURNING id`,
      [user_id, HOT_TO_WARM_DAYS]
    );

    // warm → cold: no access in WARM_TO_COLD_DAYS AND low importance
    const coldResult = await query<{ count: string }>(
      `UPDATE memories
       SET tier = 'cold', updated_at = NOW()
       WHERE user_id = $1
         AND tier = 'warm'
         AND tier != 'core'
         AND importance < $2
         AND last_accessed < NOW() - ($3 || ' days')::interval
       RETURNING id`,
      [user_id, COLD_IMPORTANCE_THRESHOLD, WARM_TO_COLD_DAYS]
    );

    const hotToWarm = hotResult.rows.length;
    const warmToCold = coldResult.rows.length;

    if (hotToWarm > 0 || warmToCold > 0) {
      results.push({ userId: user_id, hotToWarm, warmToCold });
    }
  }

  return results;
}

// ── Scheduler ────────────────────────────────────────────────

let decayInterval: ReturnType<typeof setInterval> | null = null;

async function check(): Promise<void> {
  logger.info('decay', 'Running memory decay check...');
  try {
    const results = await runDecay();
    const total = results.reduce((s, r) => s + r.hotToWarm + r.warmToCold, 0);
    if (total > 0) {
      logger.info('decay', `Decay complete: ${results.map(r =>
        `user ${r.userId.slice(0, 8)}: ${r.hotToWarm} hot→warm, ${r.warmToCold} warm→cold`
      ).join('; ')}`);
    } else {
      logger.info('decay', 'Decay complete: no memories to demote');
    }
  } catch (err) {
    logger.warn('decay', `Decay failed: ${err}`);
  }
}

export function scheduleDecay(): void {
  // Run 10 minutes after startup, then weekly
  setTimeout(check, 10 * 60 * 1000);
  decayInterval = setInterval(check, 7 * 24 * 60 * 60 * 1000);
}

export function stopDecay(): void {
  if (decayInterval) {
    clearInterval(decayInterval);
    decayInterval = null;
  }
}
