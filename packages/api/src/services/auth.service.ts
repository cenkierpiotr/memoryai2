import { query } from '../db/pool.js';
import { config } from '../config.js';
import { nanoid } from 'nanoid';
import type { User } from '@memoryai/shared';

export const authService = {
  async findByApiKey(apiKey: string): Promise<User | null> {
    const res = await query<User>(
      `SELECT id, email, name, api_key, is_admin, metadata, created_at, updated_at
       FROM users WHERE api_key = $1`,
      [apiKey]
    );
    return res.rows[0] ?? null;
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
    if (existing) return existing;

    const res = await query<User>(
      `INSERT INTO users (email, name, api_key, is_admin)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (api_key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email, name, api_key, is_admin, metadata, created_at, updated_at`,
      ['admin@memoryai.local', 'Admin', config.auth.adminApiKey]
    );
    return res.rows[0];
  },

  generateApiKey(): string {
    return nanoid(48);
  },

  async createUser(opts: { email?: string; name?: string }): Promise<User> {
    const apiKey = this.generateApiKey();
    const res = await query<User>(
      `INSERT INTO users (email, name, api_key)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, api_key, is_admin, metadata, created_at, updated_at`,
      [opts.email ?? null, opts.name ?? null, apiKey]
    );
    return res.rows[0];
  },

  async rotateApiKey(userId: string): Promise<string> {
    const newKey = this.generateApiKey();
    await query('UPDATE users SET api_key = $1 WHERE id = $2', [newKey, userId]);
    return newKey;
  },
};
