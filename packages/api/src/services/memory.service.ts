import { query, withTransaction } from '../db/pool.js';
import { embeddingService } from './embedding.service.js';
import type {
  Memory, MemorySearchResult, CreateMemoryDto, UpdateMemoryDto,
  SearchMemoriesDto, PaginationQuery, MemoryType,
} from '@memoryai/shared';

export const memoryService = {
  async create(userId: string, dto: CreateMemoryDto): Promise<Memory> {
    const embedding = await embeddingService.embed(dto.content);
    const vectorLiteral = embeddingService.toVectorLiteral(embedding);

    const res = await query<Memory>(
      `INSERT INTO memories (user_id, project_id, session_id, type, content, importance, tags, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
       RETURNING id, user_id, project_id, session_id, type, content, importance, tags, metadata,
                 created_at, updated_at, last_accessed, access_count`,
      [
        userId,
        dto.project_id ?? null,
        dto.session_id ?? null,
        dto.type ?? 'fact',
        dto.content,
        dto.importance ?? 0.5,
        dto.tags ?? [],
        JSON.stringify(dto.metadata ?? {}),
        vectorLiteral,
      ]
    );
    return res.rows[0];
  },

  async createBatch(userId: string, items: CreateMemoryDto[]): Promise<Memory[]> {
    if (items.length === 0) return [];

    const embeddings = await embeddingService.embedBatch(items.map(i => i.content));

    return withTransaction(async (client) => {
      const memories: Memory[] = [];
      for (let i = 0; i < items.length; i++) {
        const dto = items[i];
        const vectorLiteral = embeddingService.toVectorLiteral(embeddings[i]);
        const res = await client.query<Memory>(
          `INSERT INTO memories (user_id, project_id, session_id, type, content, importance, tags, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
           RETURNING id, user_id, project_id, session_id, type, content, importance, tags, metadata,
                     created_at, updated_at, last_accessed, access_count`,
          [
            userId,
            dto.project_id ?? null,
            dto.session_id ?? null,
            dto.type ?? 'fact',
            dto.content,
            dto.importance ?? 0.5,
            dto.tags ?? [],
            JSON.stringify(dto.metadata ?? {}),
            vectorLiteral,
          ]
        );
        memories.push(res.rows[0]);
      }
      return memories;
    });
  },

  async search(userId: string, dto: SearchMemoriesDto): Promise<MemorySearchResult[]> {
    const limit = Math.min(dto.limit ?? 10, 20);
    const embedding = await embeddingService.embed(dto.query);
    const vectorLiteral = embeddingService.toVectorLiteral(embedding);

    const res = await query<MemorySearchResult>(
      `SELECT * FROM search_memories($1, $2::vector, $3, $4, $5, $6, $7)`,
      [
        userId,
        vectorLiteral,
        dto.query,
        limit,
        dto.project_id ?? null,
        dto.types && dto.types.length > 0 ? dto.types : null,
        dto.min_importance ?? 0.0,
      ]
    );

    // Update access stats async (fire & forget, non-blocking)
    if (res.rows.length > 0) {
      const ids = res.rows.map(r => r.id);
      query('SELECT touch_memories($1)', [ids]).catch((err: Error) => {
        process.stderr.write(`[memory] touch_memories failed: ${err.message}\n`);
      });
    }

    return res.rows;
  },

  async findById(userId: string, id: string): Promise<Memory | null> {
    const res = await query<Memory>(
      `SELECT id, user_id, project_id, session_id, type, content, importance, tags, metadata,
              created_at, updated_at, last_accessed, access_count
       FROM memories WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return res.rows[0] ?? null;
  },

  async list(userId: string, pagination: PaginationQuery & { project_id?: string; type?: MemoryType }): Promise<{
    data: Memory[];
    total: number;
  }> {
    const limit = Math.min(pagination.limit ?? 20, 100);
    const offset = pagination.offset ?? 0;

    const conditions = ['user_id = $1'];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (pagination.project_id) {
      conditions.push(`project_id = $${paramIdx++}`);
      params.push(pagination.project_id);
    }
    if (pagination.type) {
      conditions.push(`type = $${paramIdx++}`);
      params.push(pagination.type);
    }

    const where = conditions.join(' AND ');

    const [dataRes, countRes] = await Promise.all([
      query<Memory>(
        `SELECT id, user_id, project_id, session_id, type, content, importance, tags, metadata,
                created_at, updated_at, last_accessed, access_count
         FROM memories WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM memories WHERE ${where}`,
        params
      ),
    ]);

    return {
      data: dataRes.rows,
      total: parseInt(countRes.rows[0].count, 10),
    };
  },

  async update(userId: string, id: string, dto: UpdateMemoryDto): Promise<Memory | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (dto.content !== undefined) {
      const embedding = await embeddingService.embed(dto.content);
      const vectorLiteral = embeddingService.toVectorLiteral(embedding);
      sets.push(`content = $${idx++}`, `embedding = $${idx++}::vector`);
      params.push(dto.content, vectorLiteral);
    }
    if (dto.type !== undefined) { sets.push(`type = $${idx++}`); params.push(dto.type); }
    if (dto.importance !== undefined) { sets.push(`importance = $${idx++}`); params.push(dto.importance); }
    if (dto.tags !== undefined) { sets.push(`tags = $${idx++}`); params.push(dto.tags); }
    if (dto.metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(JSON.stringify(dto.metadata)); }

    if (sets.length === 0) return this.findById(userId, id);

    params.push(id, userId);
    const res = await query<Memory>(
      `UPDATE memories SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING id, user_id, project_id, session_id, type, content, importance, tags, metadata,
                 created_at, updated_at, last_accessed, access_count`,
      params
    );
    return res.rows[0] ?? null;
  },

  async delete(userId: string, id: string): Promise<boolean> {
    const res = await query(
      'DELETE FROM memories WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (res.rowCount ?? 0) > 0;
  },

  async getRecentContext(userId: string, projectId?: string, limit = 5): Promise<Memory[]> {
    const res = await query<Memory>(
      `SELECT id, user_id, project_id, session_id, type, content, importance, tags, metadata,
              created_at, updated_at, last_accessed, access_count
       FROM memories
       WHERE user_id = $1 AND ($2::uuid IS NULL OR project_id = $2)
       ORDER BY importance DESC, created_at DESC
       LIMIT $3`,
      [userId, projectId ?? null, limit]
    );
    return res.rows;
  },
};
