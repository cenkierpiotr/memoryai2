import { query } from '../db/pool.js';
import { config } from '../config.js';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import type { User } from '@memoryai/shared';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// Simple in-memory TTL cache for API key lookups (avoids DB hit per request)
const keyCache = new Map<string, { user: User; expiresAt: number }>();
const KEY_CACHE_TTL_MS = 60_000; // 1 minute

function getCached(apiKey: string): User | null {
  const entry = keyCache.get(apiKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { keyCache.delete(apiKey); return null; }
  return entry.user;
}

function setCached(apiKey: string, user: User): void {
  // Limit cache size to prevent unbounded memory growth
  if (keyCache.size > 1000) {
    const firstKey = keyCache.keys().next().value;
    if (firstKey) keyCache.delete(firstKey);
  }
  keyCache.set(apiKey, { user, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
}

export const authService = {
  async findByApiKey(apiKey: string): Promise<User | null> {
    const cached = getCached(apiKey);
    if (cached) return cached;

    const hash = hashKey(apiKey);
    const res = await query<User>(
      `SELECT id, email, name, api_key, is_admin, metadata, created_at, updated_at
       FROM users WHERE key_hash = $1`,
      [hash]
    );
    const user = res.rows[0] ?? null;
    if (user) setCached(apiKey, user);
    return user;
  },

  async findById(id: string): Promise<User | null> {
    const res = await query<User>(
      `SELECT id, email, name, api_key, is_admin, metadata, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );
    return res.rows[0] ?? null;
  },

  async ensureAdminUser(): Promise<User> {
    const existing = await this.findByApiKey(config.auth.adminApiKey);
    if (existing) {
      // Seed taxonomy if this user has no memories yet (first boot after schema reset)
      await this.seedUserTaxonomy(existing.id);
      return existing;
    }

    const keyHash = hashKey(config.auth.adminApiKey);
    const res = await query<User>(
      `INSERT INTO users (email, name, api_key, key_hash, is_admin)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (api_key) DO UPDATE SET name = EXCLUDED.name, key_hash = EXCLUDED.key_hash
       RETURNING id, email, name, api_key, is_admin, metadata, created_at, updated_at`,
      ['admin@memoryai.local', 'Admin', config.auth.adminApiKey, keyHash]
    );
    const user = res.rows[0];
    await this.seedUserTaxonomy(user.id);
    return user;
  },

  async seedUserTaxonomy(userId: string): Promise<void> {
    try {
      await query('SELECT seed_user_memory($1)', [userId]);
    } catch (err) {
      // Non-fatal — function may not exist if DB schema is being migrated
      process.stderr.write(`[auth] seed_user_memory warning: ${(err as Error).message}\n`);
    }
  },

  generateApiKey(): string {
    return nanoid(48);
  },

  async createUser(opts: { email?: string; name?: string }): Promise<User> {
    const apiKey = this.generateApiKey();
    const keyHash = hashKey(apiKey);
    const res = await query<User>(
      `INSERT INTO users (email, name, api_key, key_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, api_key, is_admin, metadata, created_at, updated_at`,
      [opts.email ?? null, opts.name ?? null, apiKey, keyHash]
    );
    return res.rows[0];
  },

  async rotateApiKey(userId: string): Promise<string> {
    // Invalidate any cached entries for this user before issuing new key
    for (const [key, entry] of keyCache.entries()) {
      if (entry.user.id === userId) keyCache.delete(key);
    }
    const newKey = this.generateApiKey();
    const keyHash = hashKey(newKey);
    await query('UPDATE users SET api_key = $1, key_hash = $2 WHERE id = $3', [newKey, keyHash, userId]);
    return newKey;
  },
};
