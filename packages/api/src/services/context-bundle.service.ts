/**
 * Context Bundle Service
 *
 * Manages pre-computed, Redis-cached snapshots of a user's core context.
 * This is the "Phase 1" of the 2-phase context retrieval strategy:
 *
 *   Phase 1 (this service): instant load of core tier memories + pinned entities
 *   Phase 2 (memory.service): semantic vector search over hot+warm tiers
 *
 * The bundle is automatically invalidated by a DB trigger when core/hot
 * memories change. It's rebuilt on the next request if stale.
 *
 * Redis TTL: 5 minutes (within pgvector cache window, keeps DB idle)
 */

import { query } from '../db/pool.js';
import type { ContextBundle, CoreMemoryJson, EntityJson } from '@memoryai/shared';
import { config } from '../config.js';
import { decrypt, isEncrypted } from '../utils/encryption.js';
import { Redis } from 'ioredis';

const redis = new Redis(config.redis.url, {
  lazyConnect: true,
  enableReadyCheck: false,
  maxRetriesPerRequest: 1,
});

redis.on('error', (err: Error) => {
  process.stderr.write(`[bundle] Redis error: ${err.message}\n`);
});

const BUNDLE_TTL_SECONDS = 300; // 5 minutes
const BUNDLE_KEY = (userId: string) => `memoryai:bundle:${userId}`;
const CTX_LOADED_KEY = (userId: string) => `memoryai:ctx_loaded:${userId}`;
const CTX_LOADED_TTL = 1200; // 20 minutes — lazy-load window
const MAX_CONTENT_DISPLAY = 200; // chars per memory line in formatted output

export const contextBundleService = {
  /**
   * Get the context bundle for a user.
   * Returns cached bundle from Redis if fresh, otherwise rebuilds from DB.
   * Never throws — always returns a usable (possibly empty) bundle.
   */
  async get(userId: string): Promise<ContextBundle> {
    // 1. Try Redis cache
    try {
      const cached = await redis.get(BUNDLE_KEY(userId));
      if (cached) {
        return JSON.parse(cached) as ContextBundle;
      }
    } catch {
      // Redis unavailable — fall through to DB
    }

    // 2. Check DB bundle staleness
    const dbBundle = await this.getFromDb(userId);

    if (dbBundle && !dbBundle.is_stale) {
      // Fresh in DB — cache and return
      await this.cacheBundle(userId, dbBundle);
      return dbBundle;
    }

    // 3. Rebuild (stale or missing)
    return this.rebuild(userId);
  },

  async getFromDb(userId: string): Promise<ContextBundle | null> {
    const res = await query<{
      user_id: string;
      core_memories: CoreMemoryJson[];
      key_entities: EntityJson[];
      hot_summary: string;
      built_at: Date;
      is_stale: boolean;
    }>(
      `SELECT user_id, core_memories, key_entities, hot_summary, built_at, is_stale
       FROM context_bundles WHERE user_id = $1`,
      [userId]
    );
    if (!res.rows[0]) return null;
    return res.rows[0] as ContextBundle;
  },

  /**
   * Rebuild the bundle by calling the DB function, then cache it.
   * Used when bundle is stale or missing.
   */
  async rebuild(userId: string): Promise<ContextBundle> {
    await query('SELECT build_context_bundle($1)', [userId]);

    const fresh = await this.getFromDb(userId);
    const bundle: ContextBundle = fresh ?? {
      user_id: userId,
      core_memories: [],
      key_entities: [],
      hot_summary: '',
      built_at: new Date(),
      is_stale: false,
    };

    await this.cacheBundle(userId, bundle);
    return bundle;
  },

  /**
   * Invalidate the cached bundle for a user.
   * Called when memories change (the DB trigger handles the DB-level staleness,
   * this clears the Redis cache immediately).
   */
  async invalidate(userId: string): Promise<void> {
    try {
      await redis.del(BUNDLE_KEY(userId));
    } catch {
      // Redis unavailable — DB trigger already marked as stale
    }
  },

  async cacheBundle(userId: string, bundle: ContextBundle): Promise<void> {
    try {
      await redis.setex(
        BUNDLE_KEY(userId),
        BUNDLE_TTL_SECONDS,
        JSON.stringify(bundle)
      );
    } catch {
      // Redis unavailable — skip caching
    }
  },

  /**
   * Format the bundle into compact text for injection into model context.
   * Truncates long content, skips empty scaffolds, avoids decorative borders.
   */
  formatForModel(bundle: ContextBundle, projectId?: string): string {
    const lines: string[] = [];

    const truncate = (s: string) =>
      s.length > MAX_CONTENT_DISPLAY ? s.slice(0, MAX_CONTENT_DISPLAY - 1) + '…' : s;

    if (bundle.core_memories.length > 0) {
      for (const m of bundle.core_memories) {
        const content = isEncrypted(m.content) ? decrypt(m.content) : m.content;
        if (content.includes('Not yet populated') || content.includes('Not yet determined')) continue;
        const cat = m.category !== 'general' ? `[${m.category}] ` : '';
        lines.push(`${cat}${truncate(content)}`);
      }
    }

    if (bundle.key_entities.length > 0) {
      if (lines.length > 0) lines.push('');
      for (const e of bundle.key_entities) {
        const facts = e.facts.slice(0, 2).map(f => `  • ${truncate(typeof f === 'string' ? f : f.content)}`).join('\n');
        lines.push(`${e.name} (${e.type}):\n${facts}`);
      }
    }

    return lines.join('\n');
  },

  // ── Session-level lazy-load tracking ────────────────────────

  async isContextLoadedRecently(userId: string): Promise<number | null> {
    try {
      const val = await redis.get(CTX_LOADED_KEY(userId));
      if (!val) return null;
      return Math.round((Date.now() - parseInt(val, 10)) / 60000);
    } catch {
      return null;
    }
  },

  async markContextLoaded(userId: string): Promise<void> {
    try {
      await redis.setex(CTX_LOADED_KEY(userId), CTX_LOADED_TTL, Date.now().toString());
    } catch {}
  },

  async clearContextLoaded(userId: string): Promise<void> {
    try {
      await redis.del(CTX_LOADED_KEY(userId));
    } catch {}
  },

  /**
   * Get per-tier and per-category statistics for the dashboard.
   */
  async getStats(userId: string): Promise<Array<{
    tier: string;
    category: string;
    count: number;
    avg_importance: number;
  }>> {
    const res = await query<{
      tier: string;
      category: string;
      count: number;
      avg_importance: number;
    }>('SELECT * FROM get_memory_stats($1)', [userId]);
    return res.rows;
  },
};

export async function closeBundleRedis(): Promise<void> {
  await redis.quit().catch(() => redis.disconnect());
}
