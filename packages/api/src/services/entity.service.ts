import { query } from '../db/pool.js';
import { embeddingService } from './embedding.service.js';
import type { Entity, CreateEntityDto, EntityFact } from '@memoryai/shared';

export const entityService = {
  async upsert(userId: string, dto: CreateEntityDto): Promise<Entity> {
    const factsText = dto.facts?.map(f => f.content).join('. ') ?? '';
    const embedding = await embeddingService.embed(`${dto.name}. ${factsText}`.trim());
    const vectorLiteral = embeddingService.toVectorLiteral(embedding);

    const res = await query<Entity>(
      `INSERT INTO entities (user_id, project_id, name, type, aliases, facts, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::vector)
       ON CONFLICT (user_id, name) DO UPDATE SET
         type = EXCLUDED.type,
         aliases = EXCLUDED.aliases,
         facts = EXCLUDED.facts,
         metadata = EXCLUDED.metadata,
         embedding = EXCLUDED.embedding,
         updated_at = NOW()
       RETURNING id, user_id, project_id, name, type, aliases, facts, metadata, created_at, updated_at`,
      [
        userId,
        dto.project_id ?? null,
        dto.name,
        dto.type,
        dto.aliases ?? [],
        JSON.stringify(dto.facts ?? []),
        JSON.stringify(dto.metadata ?? {}),
        vectorLiteral,
      ]
    );
    return res.rows[0];
  },

  async addFact(userId: string, entityId: string, fact: EntityFact): Promise<Entity | null> {
    const res = await query<Entity>(
      `UPDATE entities
       SET facts = facts || $1::jsonb, updated_at = NOW()
       WHERE user_id = $2 AND id = $3
       RETURNING id, user_id, project_id, name, type, aliases, facts, metadata, created_at, updated_at`,
      [JSON.stringify([fact]), userId, entityId]
    );
    return res.rows[0] ?? null;
  },

  async findByName(userId: string, name: string): Promise<Entity | null> {
    const res = await query<Entity>(
      `SELECT id, user_id, project_id, name, type, aliases, facts, metadata, created_at, updated_at
       FROM entities
       WHERE user_id = $1 AND (name ILIKE $2 OR $2 = ANY(aliases))`,
      [userId, name]
    );
    return res.rows[0] ?? null;
  },

  async search(userId: string, queryText: string, limit = 5): Promise<Entity[]> {
    if (!queryText.trim()) return [];
    const embedding = await embeddingService.embedQuery(queryText); // asymmetric query prefix
    const vectorLiteral = embeddingService.toVectorLiteral(embedding);

    const res = await query<Entity>(
      `SELECT id, user_id, project_id, name, type, aliases, facts, metadata, created_at, updated_at,
              (1 - (embedding <=> $2::vector)) AS score
       FROM entities
       WHERE user_id = $1 AND embedding IS NOT NULL
       ORDER BY score DESC
       LIMIT $3`,
      [userId, vectorLiteral, limit]
    );
    return res.rows;
  },

  async list(userId: string, opts: { limit?: number; offset?: number; type?: string }): Promise<{
    data: Entity[];
    total: number;
  }> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const offset = opts.offset ?? 0;

    const conditions = ['user_id = $1'];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (opts.type) {
      conditions.push(`type = $${paramIdx++}`);
      params.push(opts.type);
    }

    const where = conditions.join(' AND ');

    const [dataRes, countRes] = await Promise.all([
      query<Entity>(
        `SELECT id, user_id, project_id, name, type, aliases, facts, metadata, created_at, updated_at
         FROM entities WHERE ${where}
         ORDER BY updated_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM entities WHERE ${where}`,
        params
      ),
    ]);

    return { data: dataRes.rows, total: parseInt(countRes.rows[0].count, 10) };
  },

  async delete(userId: string, id: string): Promise<boolean> {
    const res = await query('DELETE FROM entities WHERE id = $1 AND user_id = $2', [id, userId]);
    return (res.rowCount ?? 0) > 0;
  },
};
