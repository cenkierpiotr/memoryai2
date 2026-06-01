import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { entityService } from '../services/entity.service.js';

const factSchema = z.object({
  content: z.string().min(1).max(2000),
  source: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['person', 'project', 'company', 'tool', 'concept', 'place', 'other']),
  aliases: z.array(z.string()).max(10).optional(),
  facts: z.array(factSchema).max(50).optional(),
  project_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function entitiesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // POST /entities/search
  app.post('/entities/search', async (req, reply) => {
    const { query, limit } = z.object({
      query: z.string().min(1),
      limit: z.coerce.number().int().min(1).max(20).optional(),
    }).parse(req.body);
    const results = await entityService.search(req.user.id, query, limit);
    return reply.send({ data: results });
  });

  // GET /entities
  app.get('/entities', async (req, reply) => {
    const params = z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      type: z.string().optional(),
    }).parse(req.query);
    const result = await entityService.list(req.user.id, params);
    return reply.send({ data: result.data, meta: { total: result.total } });
  });

  // POST /entities
  app.post('/entities', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const entity = await entityService.upsert(req.user.id, body);
    return reply.code(201).send({ data: entity });
  });

  // GET /entities/by-name/:name
  app.get('/entities/by-name/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const entity = await entityService.findByName(req.user.id, name);
    if (!entity) return reply.code(404).send({ error: 'Not Found', message: 'Entity not found', statusCode: 404 });
    return reply.send({ data: entity });
  });

  // POST /entities/:id/facts
  app.post('/entities/:id/facts', async (req, reply) => {
    const { id } = req.params as { id: string };
    const fact = factSchema.parse(req.body);
    const entity = await entityService.addFact(req.user.id, id, { ...fact, created_at: new Date().toISOString() });
    if (!entity) return reply.code(404).send({ error: 'Not Found', message: 'Entity not found', statusCode: 404 });
    return reply.send({ data: entity });
  });

  // DELETE /entities/:id
  app.delete('/entities/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await entityService.delete(req.user.id, id);
    if (!deleted) return reply.code(404).send({ error: 'Not Found', message: 'Entity not found', statusCode: 404 });
    return reply.code(204).send();
  });
}
