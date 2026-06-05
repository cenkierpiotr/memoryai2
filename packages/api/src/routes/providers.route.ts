/**
 * AI Providers — CRUD for user-managed AI API endpoints.
 * Each provider has a name, type, base URL, optional API key and model list.
 * Providers are assigned to tasks (embedding, distillation, proxy) via user_settings.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { query } from '../db/pool.js';

const PROVIDER_TYPES = ['openai', 'anthropic', 'gemini', 'ollama', 'custom'] as const;

const createSchema = z.object({
  name:          z.string().min(1).max(100),
  provider_type: z.enum(PROVIDER_TYPES),
  base_url:      z.string().url().max(500),
  api_key:       z.string().max(500).optional(),
  models:        z.array(z.string().max(200)).max(100).optional(),
  notes:         z.string().max(1000).optional(),
  is_active:     z.boolean().optional(),
});

const updateSchema = createSchema.partial();

interface Provider {
  id: string; user_id: string; name: string; provider_type: string;
  base_url: string; api_key: string | null; models: string[];
  is_active: boolean; notes: string | null; created_at: string; updated_at: string;
}

function maskKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

function sanitize(p: Provider, showKey = false) {
  return { ...p, api_key: showKey ? p.api_key : maskKey(p.api_key) };
}

export async function providersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /providers
  app.get('/providers', async (req: FastifyRequest, reply: FastifyReply) => {
    const res = await query<Provider>(
      `SELECT * FROM ai_providers WHERE user_id = $1 ORDER BY created_at`,
      [req.user.id]
    );
    return reply.send({ data: res.rows.map(p => sanitize(p)) });
  });

  // POST /providers
  app.post('/providers', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = createSchema.parse(req.body);
    const res = await query<Provider>(
      `INSERT INTO ai_providers (user_id, name, provider_type, base_url, api_key, models, notes, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [req.user.id, body.name, body.provider_type, body.base_url,
       body.api_key ?? null, body.models ?? [], body.notes ?? null, body.is_active ?? true]
    );
    return reply.code(201).send({ data: sanitize(res.rows[0]) });
  });

  // GET /providers/:id
  app.get('/providers/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const res = await query<Provider>(
      `SELECT * FROM ai_providers WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Not Found' });
    return reply.send({ data: sanitize(res.rows[0]) });
  });

  // PATCH /providers/:id
  app.patch('/providers/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [id, req.user.id];
    let i = 3;
    if (body.name         !== undefined) { sets.push(`name = $${i++}`);          vals.push(body.name); }
    if (body.provider_type!== undefined) { sets.push(`provider_type = $${i++}`); vals.push(body.provider_type); }
    if (body.base_url     !== undefined) { sets.push(`base_url = $${i++}`);      vals.push(body.base_url); }
    if (body.api_key      !== undefined) { sets.push(`api_key = $${i++}`);       vals.push(body.api_key); }
    if (body.models       !== undefined) { sets.push(`models = $${i++}`);        vals.push(body.models); }
    if (body.notes        !== undefined) { sets.push(`notes = $${i++}`);         vals.push(body.notes); }
    if (body.is_active    !== undefined) { sets.push(`is_active = $${i++}`);     vals.push(body.is_active); }

    const res = await query<Provider>(
      `UPDATE ai_providers SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      vals
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Not Found' });
    return reply.send({ data: sanitize(res.rows[0]) });
  });

  // DELETE /providers/:id
  app.delete('/providers/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const res = await query(
      `DELETE FROM ai_providers WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user.id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'Not Found' });
    return reply.code(204).send();
  });

  // POST /providers/:id/test — test connection
  app.post('/providers/:id/test', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const res = await query<Provider>(
      `SELECT * FROM ai_providers WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    const provider = res.rows[0];
    if (!provider) return reply.code(404).send({ error: 'Not Found' });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.api_key) headers['Authorization'] = `Bearer ${provider.api_key}`;

    let testUrl: string;
    let ok = false;
    let message = '';

    try {
      switch (provider.provider_type) {
        case 'ollama':
          testUrl = `${provider.base_url.replace(/\/$/, '')}/api/tags`;
          break;
        case 'openai':
        case 'custom':
          testUrl = `${provider.base_url.replace(/\/$/, '')}/models`;
          break;
        case 'anthropic':
          testUrl = `${provider.base_url.replace(/\/$/, '')}/v1/models`;
          headers['anthropic-version'] = '2023-06-01';
          if (provider.api_key) { delete headers['Authorization']; headers['x-api-key'] = provider.api_key; }
          break;
        case 'gemini':
          testUrl = `${provider.base_url.replace(/\/$/, '')}/v1/models${provider.api_key ? `?key=${provider.api_key}` : ''}`;
          delete headers['Authorization'];
          break;
        default:
          testUrl = provider.base_url;
      }

      const r = await fetch(testUrl, { headers, signal: AbortSignal.timeout(8_000) });
      ok = r.ok || r.status === 401; // 401 means we reached the server (just bad key)
      message = ok ? `Connected (HTTP ${r.status})` : `HTTP ${r.status}`;

      // For Ollama: extract model list
      if (ok && provider.provider_type === 'ollama') {
        const data = await r.json() as { models?: { name: string }[] };
        const names = (data.models ?? []).map((m: { name: string }) => m.name);
        if (names.length > 0) {
          await query(
            `UPDATE ai_providers SET models = $1, updated_at = NOW() WHERE id = $2`,
            [names, id]
          );
          message += ` — found ${names.length} models`;
        }
      }
    } catch (err) {
      ok = false;
      message = String(err instanceof Error ? err.message : err).slice(0, 200);
    }

    return reply.send({ data: { ok, message } });
  });
}
