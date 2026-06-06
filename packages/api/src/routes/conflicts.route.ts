/**
 * Conflicts Route — GET /v1/conflicts
 *
 * Returns memories flagged as conflicts by the proactive worker
 * (memories with tag "conflict" and "needs_review").
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { query } from '../db/pool.js';
import type { Memory } from '@memoryai/shared';

const MEMORY_COLS = `id, user_id, project_id, session_id, tier, category, type, content,
  importance, tags, language, pinned, is_shared, metadata,
  created_at, updated_at, last_accessed, access_count`;

const listConflictsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  resolved: z.coerce.boolean().optional(),
});

export async function conflictsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * GET /conflicts
   *
   * Returns all memories with tags containing both 'conflict' and 'needs_review'.
   * Pass ?resolved=true to include already-resolved conflicts (tag 'conflict' but NOT 'needs_review').
   */
  app.get('/conflicts', async (req, reply) => {
    const params = listConflictsSchema.parse(req.query);
    const limit = Math.min(params.limit ?? 20, 100);
    const offset = params.offset ?? 0;
    const includeResolved = params.resolved ?? false;

    const tagFilter = includeResolved
      ? `'conflict' = ANY(tags)`
      : `'conflict' = ANY(tags) AND 'needs_review' = ANY(tags)`;

    const [dataRes, countRes] = await Promise.all([
      query<Memory>(
        `SELECT ${MEMORY_COLS}
         FROM memories
         WHERE user_id = $1
           AND ${tagFilter}
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM memories
         WHERE user_id = $1
           AND ${tagFilter}`,
        [req.user.id],
      ),
    ]);

    return reply.send({
      data: dataRes.rows,
      meta: {
        total: parseInt(countRes.rows[0].count, 10),
        limit,
        offset,
      },
    });
  });

  /**
   * PATCH /conflicts/:id/resolve
   *
   * Mark a conflict memory as resolved by removing the 'needs_review' tag.
   */
  app.patch('/conflicts/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };

    const res = await query<Memory>(
      `UPDATE memories
       SET tags = array_remove(tags, 'needs_review'),
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND 'conflict' = ANY(tags)
       RETURNING ${MEMORY_COLS}`,
      [id, req.user.id],
    );

    if (!res.rows[0]) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'Conflict memory not found',
        statusCode: 404,
      });
    }

    return reply.send({ data: res.rows[0] });
  });
}
