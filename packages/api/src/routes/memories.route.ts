import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { memoryService } from '../services/memory.service.js';
import type { MemoryType } from '@memoryai/shared';

const MEMORY_TYPES: MemoryType[] = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'];

const createSchema = z.object({
  content: z.string().min(1).max(10_000),
  type: z.enum(['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary']).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).max(20).optional(),
  project_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSchema = createSchema.partial().omit({ project_id: true, session_id: true });

const searchSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  project_id: z.string().uuid().optional(),
  types: z.array(z.enum(['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'])).optional(),
  min_importance: z.coerce.number().min(0).max(1).optional(),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  project_id: z.string().uuid().optional(),
  type: z.enum(['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary']).optional(),
});

export async function memoriesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // POST /memories/search
  app.post('/memories/search', async (req, reply) => {
    const body = searchSchema.parse(req.body);
    const results = await memoryService.search(req.user.id, body);
    return reply.send({ data: results, meta: { total: results.length } });
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
}
