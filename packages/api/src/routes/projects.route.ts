import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { projectService } from '../services/project.service.js';

const createSchema = z.object({
  name: z.string().min(1).max(255),
  aliases: z.array(z.string().min(1).max(255)).max(50).optional(),
  git_remote: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  aliases: z.array(z.string().min(1).max(255)).max(50).optional(),
  git_remote: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /projects
  app.get('/projects', async (req, reply) => {
    const projects = await projectService.list(req.user.id);
    return reply.send({ data: projects });
  });

  // POST /projects
  app.post('/projects', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const project = await projectService.create(req.user.id, body);
    return reply.code(201).send({ data: project });
  });

  // GET /projects/resolve?name=X  — resolve any alias to project
  app.get('/projects/resolve', async (req, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.query);
    const id = await projectService.resolveByName(req.user.id, name);
    if (!id) return reply.code(404).send({ error: 'Not Found', message: 'No project matches that name or alias', statusCode: 404 });
    const project = await projectService.findById(req.user.id, id);
    return reply.send({ data: project });
  });

  // GET /projects/:id
  app.get('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await projectService.findById(req.user.id, id);
    if (!project) return reply.code(404).send({ error: 'Not Found', message: 'Project not found', statusCode: 404 });
    return reply.send({ data: project });
  });

  // PATCH /projects/:id
  app.patch('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const project = await projectService.update(req.user.id, id, body);
    if (!project) return reply.code(404).send({ error: 'Not Found', message: 'Project not found', statusCode: 404 });
    return reply.send({ data: project });
  });

  // POST /projects/:id/aliases  — append aliases without full replace
  app.post('/projects/:id/aliases', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { aliases } = z.object({
      aliases: z.array(z.string().min(1).max(255)).min(1).max(50),
    }).parse(req.body);
    const project = await projectService.addAliases(req.user.id, id, aliases);
    if (!project) return reply.code(404).send({ error: 'Not Found', message: 'Project not found', statusCode: 404 });
    return reply.send({ data: project });
  });

  // DELETE /projects/:id
  app.delete('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await projectService.delete(req.user.id, id);
    if (!deleted) return reply.code(404).send({ error: 'Not Found', message: 'Project not found', statusCode: 404 });
    return reply.code(204).send();
  });
}
