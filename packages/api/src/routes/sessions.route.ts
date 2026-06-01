import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { sessionService } from '../services/session.service.js';
import { distillationQueue } from '../jobs/distillation.queue.js';

const createSchema = z.object({
  project_id: z.string().uuid().optional(),
  title: z.string().max(255).optional(),
  model: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1).max(100_000),
  metadata: z.record(z.unknown()).optional(),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(['active', 'closed', 'distilled']).optional(),
});

export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /sessions
  app.get('/sessions', async (req, reply) => {
    const params = listSchema.parse(req.query);
    const result = await sessionService.list(req.user.id, params);
    return reply.send({ data: result.data, meta: { total: result.total } });
  });

  // POST /sessions
  app.post('/sessions', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const session = await sessionService.create(req.user.id, body);
    return reply.code(201).send({ data: session });
  });

  // GET /sessions/:id
  app.get('/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await sessionService.findById(req.user.id, id);
    if (!session) return reply.code(404).send({ error: 'Not Found', message: 'Session not found', statusCode: 404 });
    return reply.send({ data: session });
  });

  // GET /sessions/:id/messages
  app.get('/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { limit } = z.object({ limit: z.coerce.number().optional() }).parse(req.query);
    const session = await sessionService.findById(req.user.id, id);
    if (!session) return reply.code(404).send({ error: 'Not Found', message: 'Session not found', statusCode: 404 });
    const messages = await sessionService.getMessages(req.user.id, id, limit);
    return reply.send({ data: messages });
  });

  // POST /sessions/:id/messages
  app.post('/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = messageSchema.parse(req.body);
    const message = await sessionService.addMessage(req.user.id, id, body);
    return reply.code(201).send({ data: message });
  });

  // POST /sessions/:id/close
  app.post('/sessions/:id/close', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await sessionService.close(req.user.id, id);
    if (!session) return reply.code(404).send({ error: 'Not Found', message: 'Session not found or already closed', statusCode: 404 });

    // Queue background distillation
    await distillationQueue.add({ sessionId: id, userId: req.user.id });

    return reply.send({ data: session, meta: { distillation: 'queued' } });
  });
}
