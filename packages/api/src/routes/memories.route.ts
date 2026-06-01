import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { memoryService } from '../services/memory.service.js';
import { contextBundleService } from '../services/context-bundle.service.js';

const TYPES = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'] as const;
const TIERS = ['core', 'hot', 'warm', 'cold'] as const;
const CATEGORIES = [
  'user_profile','meta_instructions','active_project','technical_stack',
  'preferences','workflow','domain_knowledge','decisions','constraints',
  'relationships','temporal','archive',
  'infrastructure','credentials','shared_config',
  'general',
] as const;

const createSchema = z.object({
  content: z.string().min(1).max(10_000),
  type: z.enum(TYPES).optional(),
  tier: z.enum(TIERS).optional(),
  category: z.enum(CATEGORIES).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).max(20).optional(),
  language: z.string().max(10).optional(),
  pinned: z.boolean().optional(),
  is_shared: z.boolean().optional(),
  project_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSchema = z.object({
  content: z.string().min(1).max(10_000).optional(),
  type: z.enum(TYPES).optional(),
  tier: z.enum(TIERS).optional(),
  category: z.enum(CATEGORIES).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).max(20).optional(),
  pinned: z.boolean().optional(),
  is_shared: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  project_id: z.string().uuid().optional(),
  types: z.array(z.enum(TYPES)).optional(),
  categories: z.array(z.enum(CATEGORIES)).optional(),
  tiers: z.array(z.enum(TIERS)).optional(),
  min_importance: z.coerce.number().min(0).max(1).optional(),
  include_cold: z.coerce.boolean().optional(),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  project_id: z.string().uuid().optional(),
  type: z.enum(TYPES).optional(),
  tier: z.enum(TIERS).optional(),
  category: z.enum(CATEGORIES).optional(),
});

const linkSchema = z.object({
  target_memory_id: z.string().uuid().optional(),
  target_entity_id: z.string().uuid().optional(),
  link_type: z.enum(['references','supersedes','elaborates','contradicts','relates_to']),
}).refine(d => !!(d.target_memory_id || d.target_entity_id), {
  message: 'Either target_memory_id or target_entity_id is required',
});

export async function memoriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // POST /memories/search  — semantic search (phase 2)
  app.post('/memories/search', async (req, reply) => {
    const body = searchSchema.parse(req.body);
    const results = await memoryService.search(req.user.id, body);
    return reply.send({ data: results, meta: { total: results.length } });
  });

  // GET /memories/core  — instant core context (phase 1, no vector)
  app.get('/memories/core', async (req, reply) => {
    const { project_id, limit } = z.object({
      project_id: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(30).optional(),
    }).parse(req.query);
    const memories = await memoryService.getCoreContext(req.user.id, project_id, limit);
    return reply.send({ data: memories });
  });

  // GET /memories/context-bundle  — pre-built bundle (fastest possible)
  app.get('/memories/context-bundle', async (req, reply) => {
    const bundle = await contextBundleService.get(req.user.id);
    return reply.send({ data: bundle });
  });

  // GET /memories/stats  — tier/category breakdown
  app.get('/memories/stats', async (req, reply) => {
    const stats = await memoryService.getStats(req.user.id);
    return reply.send({ data: stats });
  });

  // GET /memories
  app.get('/memories', async (req, reply) => {
    const params = listSchema.parse(req.query);
    const result = await memoryService.list(req.user.id, params);
    return reply.send({ data: result.data, meta: { total: result.total } });
  });

  // POST /memories
  app.post('/memories', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const memory = await memoryService.create(req.user.id, body);
    return reply.code(201).send({ data: memory });
  });

  // POST /memories/batch
  app.post('/memories/batch', async (req, reply) => {
    const body = z.array(createSchema).max(50).parse(req.body);
    const memories = await memoryService.createBatch(req.user.id, body);
    return reply.code(201).send({ data: memories });
  });

  // GET /memories/:id
  app.get('/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const memory = await memoryService.findById(req.user.id, id);
    if (!memory) return reply.code(404).send({ error: 'Not Found', message: 'Memory not found', statusCode: 404 });
    return reply.send({ data: memory });
  });

  // PATCH /memories/:id
  app.patch('/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const memory = await memoryService.update(req.user.id, id, body);
    if (!memory) return reply.code(404).send({ error: 'Not Found', message: 'Memory not found', statusCode: 404 });
    return reply.send({ data: memory });
  });

  // DELETE /memories/:id
  app.delete('/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await memoryService.delete(req.user.id, id);
    if (!deleted) return reply.code(404).send({ error: 'Not Found', message: 'Memory not found', statusCode: 404 });
    return reply.code(204).send();
  });

  // GET /memories/:id/links
  app.get('/memories/:id/links', async (req, reply) => {
    const { id } = req.params as { id: string };
    const links = await memoryService.getLinks(req.user.id, id);
    return reply.send({ data: links });
  });

  // POST /memories/:id/links
  app.post('/memories/:id/links', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = linkSchema.parse(req.body);
    await memoryService.addLink(req.user.id, id, {
      memoryId: body.target_memory_id,
      entityId: body.target_entity_id,
    }, body.link_type);
    return reply.code(201).send({ data: { ok: true } });
  });
}
