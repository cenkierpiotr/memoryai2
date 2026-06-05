import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { auditService } from '../services/audit.service.js';
import { runDeduplication } from '../jobs/deduplication.worker.js';
import { runDecay } from '../jobs/decay.worker.js';
import { query } from '../db/pool.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // ── Audit log ───────────────────────────────────────────────

  app.get('/admin/audit-log', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit, offset, operation } = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      operation: z.enum(['read', 'write', 'delete', 'decrypt']).optional(),
    }).parse(req.query);

    const result = await auditService.list(req.user.id, { limit, offset, operation });
    return reply.send({ data: result.data, meta: { total: result.total } });
  });

  // ── Export / Import ─────────────────────────────────────────

  app.get('/admin/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const [memories, entities, projects] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT id, tier, category, type, content, importance, tags, language,
                is_shared, pinned, project_id, session_id, metadata, created_at
         FROM memories WHERE user_id = $1 AND tier != 'cold' ORDER BY created_at ASC`,
        [req.user.id]
      ),
      query<Record<string, unknown>>(
        `SELECT id, name, type, aliases, facts, metadata, created_at
         FROM entities WHERE user_id = $1 ORDER BY created_at ASC`,
        [req.user.id]
      ),
      query<Record<string, unknown>>(
        `SELECT id, name, aliases, git_remote, description, metadata, created_at
         FROM projects WHERE user_id = $1 ORDER BY created_at ASC`,
        [req.user.id]
      ),
    ]);

    const exportData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      memories: memories.rows,
      entities: entities.rows,
      projects: projects.rows,
    };

    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="memoryai-export-${Date.now()}.json"`)
      .send(exportData);
  });

  app.post('/admin/import', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = z.object({
      version: z.string(),
      memories: z.array(z.object({
        content: z.string().min(1).max(10_000),
        type: z.string().optional(),
        tier: z.string().optional(),
        category: z.string().optional(),
        importance: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        is_shared: z.boolean().optional(),
      })).max(5000),
      entities: z.array(z.object({
        name: z.string().min(1),
        type: z.string(),
        facts: z.array(z.unknown()).optional(),
        aliases: z.array(z.string()).optional(),
      })).max(1000).optional(),
    }).parse(req.body);

    // Import memories without embeddings (will be generated lazily on first search)
    // For now insert as warm/general without vectors — they'll get embeddings when accessed
    let memoriesImported = 0;
    for (const m of body.memories) {
      await query(
        `INSERT INTO memories (user_id, tier, category, type, content, importance, tags, is_shared, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{"imported": true}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          req.user.id,
          m.tier ?? 'warm',
          m.category ?? 'general',
          m.type ?? 'fact',
          m.content,
          m.importance ?? 0.5,
          m.tags ?? [],
          m.is_shared ?? false,
        ]
      ).catch(() => {}); // skip individual failures
      memoriesImported++;
    }

    return reply.code(201).send({
      data: { memories_imported: memoriesImported },
    });
  });

  // ── Vector index management ─────────────────────────────────

  app.get('/admin/vector-index/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const res = await query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'memories' AND indexname = 'idx_memories_vector'`
    );
    const count = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL'
    );
    return reply.send({
      data: {
        index_exists: res.rows.length > 0,
        vectors_count: parseInt(count.rows[0].count, 10),
        recommended_lists: Math.max(10, Math.min(1000, Math.floor(Math.sqrt(parseInt(count.rows[0].count, 10))))),
      },
    });
  });

  app.post('/admin/vector-index/create', async (_req: FastifyRequest, reply: FastifyReply) => {
    const count = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL'
    );
    const n = parseInt(count.rows[0].count, 10);
    if (n < 100) {
      return reply.code(400).send({
        error: 'Too few vectors',
        message: `Need at least 100 vectors to create IVFFlat index (have ${n}). Add more memories first.`,
        statusCode: 400,
      });
    }

    const lists = Math.max(10, Math.min(1000, Math.floor(Math.sqrt(n))));

    // Drop old index if exists, create new with correct lists param
    await query('DROP INDEX CONCURRENTLY IF EXISTS idx_memories_vector');
    await query(
      `CREATE INDEX CONCURRENTLY idx_memories_vector ON memories
       USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${lists})`
    );

    return reply.send({
      data: { created: true, lists, vectors_indexed: n },
    });
  });

  // ── Deduplication ───────────────────────────────────────────

  app.post('/admin/deduplicate', async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runDeduplication(req.user.id);
    return reply.send({ data: result });
  });

  // ── Memory decay ───────────────────────────────────────────

  app.post('/admin/decay', async (req: FastifyRequest, reply: FastifyReply) => {
    const results = await runDecay();
    const total = results.reduce((s, r) => s + r.hotToWarm + r.warmToCold, 0);
    return reply.send({ data: { results, total } });
  });

  // ── Stats (admin view) ──────────────────────────────────────

  app.get('/admin/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const [memStats, auditStats] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT tier, COUNT(*) as count, ROUND(AVG(importance)::NUMERIC, 2) as avg_importance
         FROM memories WHERE user_id = $1 GROUP BY tier ORDER BY tier`,
        [req.user.id]
      ),
      query<Record<string, unknown>>(
        `SELECT operation, COUNT(*) as count
         FROM audit_log WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY operation`,
        [req.user.id]
      ),
    ]);

    return reply.send({
      data: {
        memories_by_tier: memStats.rows,
        audit_last_30d: auditStats.rows,
      },
    });
  });

  // ── Config (read/write user settings) ──────────────────────

  // Allowlist of keys that can be set via UI (no arbitrary env injection)
  const ALLOWED_CONFIG_KEYS = new Set([
    'embedding.provider', 'embedding.ollamaModel', 'embedding.ollamaBaseUrl',
    'embedding.dimensions', 'embedding.geminiApiKey', 'embedding.openaiApiKey',
    'distillation.provider', 'distillation.model', 'distillation.ollamaBaseUrl',
    'distillation.geminiApiKey', 'distillation.anthropicApiKey', 'distillation.openaiApiKey',
    'distillation.inactivityMinutes', 'reranker.enabled', 'reranker.model',
    'proxy.backendUrl', 'proxy.backendApiKey',
  ]);

  app.get('/admin/config', async (req: FastifyRequest, reply: FastifyReply) => {
    // Merge env defaults with DB overrides
    const dbSettings = await query<{ key: string; value: string }>(
      'SELECT key, value FROM user_settings WHERE user_id = $1', [req.user.id]
    );
    const overrides = Object.fromEntries(dbSettings.rows.map(r => [r.key, r.value]));

    const defaults: Record<string, string> = {
      'embedding.provider':       process.env.EMBEDDING_PROVIDER ?? 'ollama',
      'embedding.ollamaModel':    process.env.OLLAMA_EMBED_MODEL ?? 'qwen3-embedding:0.6b',
      'embedding.ollamaBaseUrl':  process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      'embedding.dimensions':     process.env.EMBED_DIMENSIONS ?? '1024',
      'distillation.provider':    process.env.DISTILL_PROVIDER ?? 'ollama',
      'distillation.model':       process.env.DISTILL_MODEL ?? 'qwen2.5:7b-instruct-q4_K_M',
      'distillation.ollamaBaseUrl': process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      'distillation.inactivityMinutes': process.env.DISTILL_INACTIVITY_MINUTES ?? '15',
      'reranker.enabled':         process.env.RERANKER_ENABLED ?? 'true',
      'reranker.model':           process.env.RERANKER_MODEL ?? 'qwen3-reranker:0.6b',
      'proxy.backendUrl':         process.env.PROXY_BACKEND_URL ?? 'https://api.openai.com',
      'proxy.backendApiKey':      '',
    };

    return reply.send({ data: { ...defaults, ...overrides } });
  });

  app.patch('/admin/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = z.record(z.string()).parse(req.body);
    const allowed = Object.entries(body).filter(([k]) => ALLOWED_CONFIG_KEYS.has(k));

    for (const [key, value] of allowed) {
      await query(
        `INSERT INTO user_settings(user_id, key, value, updated_at)
         VALUES($1,$2,$3,NOW())
         ON CONFLICT(user_id,key) DO UPDATE SET value=$3, updated_at=NOW()`,
        [req.user.id, key, value]
      );
    }

    return reply.send({ data: { updated: allowed.map(([k]) => k) } });
  });
}
