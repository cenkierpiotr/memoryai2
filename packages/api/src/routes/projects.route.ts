import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { projectService } from '../services/project.service.js';
import { query } from '../db/pool.js';

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

  // GET /projects/:id/stats
  app.get('/projects/:id/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await projectService.findById(req.user.id, id);
    if (!project) return reply.code(404).send({ error: 'Not Found', message: 'Project not found', statusCode: 404 });

    const result = await query<{
      total: string;
      core_count: string;
      hot_count: string;
      warm_count: string;
      cold_count: string;
      shared_count: string;
      credentials_count: string;
      pending_consolidation: string;
      avg_importance: string | null;
      last_memory_at: Date | null;
    }>(
      `SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE tier = 'core')             AS core_count,
        COUNT(*) FILTER (WHERE tier = 'hot')              AS hot_count,
        COUNT(*) FILTER (WHERE tier = 'warm')             AS warm_count,
        COUNT(*) FILTER (WHERE tier = 'cold')             AS cold_count,
        COUNT(*) FILTER (WHERE is_shared = TRUE)          AS shared_count,
        COUNT(*) FILTER (WHERE category = 'credentials')  AS credentials_count,
        COUNT(*) FILTER (WHERE category = 'temporal'
          AND consolidation_status = 'pending')           AS pending_consolidation,
        ROUND(AVG(importance)::numeric, 3)                AS avg_importance,
        MAX(created_at)                                   AS last_memory_at
       FROM memories
       WHERE user_id = $1 AND project_id = $2`,
      [req.user.id, id]
    );

    const row = result.rows[0];
    return reply.send({
      data: {
        project_id: id,
        total: Number(row.total),
        core_count: Number(row.core_count),
        hot_count: Number(row.hot_count),
        warm_count: Number(row.warm_count),
        cold_count: Number(row.cold_count),
        shared_count: Number(row.shared_count),
        credentials_count: Number(row.credentials_count),
        pending_consolidation: Number(row.pending_consolidation),
        avg_importance: row.avg_importance !== null ? Number(row.avg_importance) : null,
        last_memory_at: row.last_memory_at,
      },
    });
  });

  // DELETE /projects/:id
  app.delete('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await projectService.delete(req.user.id, id);
    if (!deleted) return reply.code(404).send({ error: 'Not Found', message: 'Project not found', statusCode: 404 });
    return reply.code(204).send();
  });
}
