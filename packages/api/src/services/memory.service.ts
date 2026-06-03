import { query, withTransaction } from '../db/pool.js';
import { embeddingService } from './embedding.service.js';
import { contextBundleService } from './context-bundle.service.js';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption.js';
import { auditService } from './audit.service.js';
import type {
  Memory, MemorySearchResult, CoreMemory,
  CreateMemoryDto, UpdateMemoryDto, SearchMemoriesDto,
  PaginationQuery, MemoryType, MemoryTier, MemoryCategory,
} from '@memoryai/shared';

const MEMORY_COLS = `id, user_id, project_id, session_id, tier, category, type, content,
  importance, tags, language, pinned, is_shared, metadata,
  created_at, updated_at, last_accessed, access_count`;

// Categories that are automatically shared across all projects
const AUTO_SHARED_CATEGORIES: MemoryCategory[] = ['credentials', 'infrastructure', 'shared_config'];
// Categories whose content is encrypted at rest
const ENCRYPTED_CATEGORIES: MemoryCategory[] = ['credentials'];

function prepareContent(content: string, category: MemoryCategory): string {
  return ENCRYPTED_CATEGORIES.includes(category) ? encrypt(content) : content;
}

function decryptContent(memory: Memory, userId?: string): Memory {
  if (isEncrypted(memory.content)) {
    const plain = decrypt(memory.content);
    if (userId) {
      auditService.log({
        userId,
        memoryId: memory.id,
        operation: 'decrypt',
        category: memory.category,
        contentPreview: plain.slice(0, 60),
      });
    }
    return { ...memory, content: plain };
  }
  return memory;
}

function decryptResults<T extends Memory>(rows: T[], userId?: string): T[] {
  return rows.map(r => (isEncrypted(r.content) ? decryptContent(r as unknown as Memory, userId) as unknown as T : r));
}

export const memoryService = {
  async create(userId: string, dto: CreateMemoryDto): Promise<Memory> {
    const category = (dto.category ?? 'general') as MemoryCategory;
    const isShared = dto.is_shared ?? AUTO_SHARED_CATEGORIES.includes(category);
    const content = prepareContent(dto.content, category);
    const embedding = await embeddingService.embed(dto.content); // embed plaintext
    const vectorLiteral = embeddingService.toVectorLiteral(embedding);

    const res = await query<Memory>(
      `INSERT INTO memories
         (user_id, project_id, session_id, tier, category, type, content,
          importance, tags, language, pinned, is_shared, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::vector)
       RETURNING ${MEMORY_COLS}`,
      [
        userId,
        dto.project_id ?? null,
        dto.session_id ?? null,
        dto.tier ?? 'warm',
        category,
        dto.type ?? 'fact',
        content,
        dto.importance ?? 0.5,
        dto.tags ?? [],
        dto.language ?? 'auto',
        dto.pinned ?? false,
        isShared,
        JSON.stringify(dto.metadata ?? {}),
        vectorLiteral,
      ]
    );

    if (res.rows[0].tier === 'core' || res.rows[0].tier === 'hot' || isShared) {
      contextBundleService.invalidate(userId).catch(() => {});
    }

    return decryptContent(res.rows[0], userId);
  },

  async createBatch(userId: string, items: CreateMemoryDto[]): Promise<Memory[]> {
    if (items.length === 0) return [];

    const embeddings = await embeddingService.embedBatch(items.map(i => i.content));
    let invalidateBundle = false;

    const memories = await withTransaction(async (client) => {
      const result: Memory[] = [];
      for (let i = 0; i < items.length; i++) {
        const dto = items[i];
        const category = (dto.category ?? 'general') as MemoryCategory;
        const isShared = dto.is_shared ?? AUTO_SHARED_CATEGORIES.includes(category);
        const content = prepareContent(dto.content, category);
        const vectorLiteral = embeddingService.toVectorLiteral(embeddings[i]);
        const res = await client.query<Memory>(
          `INSERT INTO memories
             (user_id, project_id, session_id, tier, category, type, content,
              importance, tags, language, pinned, is_shared, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::vector)
           RETURNING ${MEMORY_COLS}`,
          [
            userId,
            dto.project_id ?? null,
            dto.session_id ?? null,
            dto.tier ?? 'warm',
            category,
            dto.type ?? 'fact',
            content,
            dto.importance ?? 0.5,
            dto.tags ?? [],
            dto.language ?? 'auto',
            dto.pinned ?? false,
            isShared,
            JSON.stringify(dto.metadata ?? {}),
            vectorLiteral,
          ]
        );
        result.push(decryptContent(res.rows[0], userId));
        if (res.rows[0].tier === 'core' || res.rows[0].tier === 'hot' || isShared) {
          invalidateBundle = true;
        }
      }
      return result;
    });

    if (invalidateBundle) {
      contextBundleService.invalidate(userId).catch(() => {});
    }

    return memories;
  },

  /**
   * Phase 2 semantic search — hot+warm tiers only.
   * Core tier is loaded separately via getCoreContext / contextBundleService.
   * Uses search_memories_v2 with tier boost + recency weighting.
   */
  async search(userId: string, dto: SearchMemoriesDto): Promise<MemorySearchResult[]> {
    if (!dto.query.trim()) return [];
    const limit = Math.min(dto.limit ?? 10, 20);
    const embedding = await embeddingService.embed(dto.query);
    const vectorLiteral = embeddingService.toVectorLiteral(embedding);

    const res = await query<MemorySearchResult & {
      tier: MemoryTier; category: MemoryCategory; recency_score: number;
    }>(
      `SELECT
         id, content, type, tier, category, importance, tags, 'auto'::varchar AS language, FALSE AS pinned,
         metadata, created_at, session_id,
         '' AS user_id, NULL AS project_id, NULL AS updated_at, 0 AS access_count,
         NOW() AS last_accessed,
         vector_score, text_score, recency_score, combined_score
       FROM search_memories_v2($1, $2::vector, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        vectorLiteral,
        dto.query,
        limit,
        dto.project_id ?? null,
        dto.types && dto.types.length > 0 ? dto.types : null,
        dto.categories && dto.categories.length > 0 ? dto.categories : null,
        dto.min_importance ?? 0.0,
        dto.include_cold ?? false,
      ]
    );

    const results = decryptResults(res.rows.map(r => ({ ...r, user_id: userId })), userId);

    // Update access stats async (triggers auto-promotion to hot tier)
    if (results.length > 0) {
      const ids = results.map(r => r.id);
      query('SELECT touch_memories($1)', [ids]).catch((err: Error) => {
        process.stderr.write(`[memory] touch_memories failed: ${err.message}\n`);
      });
    }

    return results;
  },

  /**
   * Phase 1: instant core context retrieval — no vector needed.
   * Uses partial index on tier='core', returns in <5ms.
   */
  async getCoreContext(userId: string, projectId?: string, limit = 15): Promise<CoreMemory[]> {
    const res = await query<CoreMemory>(
      `SELECT id, content, type, category, importance, tags, metadata, created_at
       FROM get_core_context($1, $2, $3)`,
      [userId, projectId ?? null, limit]
    );
    return res.rows;
  },

  async findById(userId: string, id: string): Promise<Memory | null> {
    const res = await query<Memory>(
      `SELECT ${MEMORY_COLS} FROM memories WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return res.rows[0] ? decryptContent(res.rows[0], userId) : null;
  },

  async list(userId: string, pagination: PaginationQuery & {
    project_id?: string;
    type?: MemoryType;
    tier?: MemoryTier;
    category?: MemoryCategory;
  }): Promise<{ data: Memory[]; total: number }> {
    const limit = Math.min(pagination.limit ?? 20, 100);
    const offset = pagination.offset ?? 0;

    const conditions = ['user_id = $1'];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (pagination.project_id) { conditions.push(`project_id = $${paramIdx++}`); params.push(pagination.project_id); }
    if (pagination.type) { conditions.push(`type = $${paramIdx++}`); params.push(pagination.type); }
    if (pagination.tier) { conditions.push(`tier = $${paramIdx++}`); params.push(pagination.tier); }
    if (pagination.category) { conditions.push(`category = $${paramIdx++}`); params.push(pagination.category); }

    const where = conditions.join(' AND ');

    const [dataRes, countRes] = await Promise.all([
      query<Memory>(
        `SELECT ${MEMORY_COLS} FROM memories
         WHERE ${where}
         ORDER BY tier = 'core' DESC, importance DESC, created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM memories WHERE ${where}`,
        params
      ),
    ]);

    return {
      data: decryptResults(dataRes.rows, userId),
      total: parseInt(countRes.rows[0].count, 10),
    };
  },

  async update(userId: string, id: string, dto: UpdateMemoryDto): Promise<Memory | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (dto.content !== undefined) {
      const existing = await this.findById(userId, id);
      const category = (dto.category ?? existing?.category ?? 'general') as MemoryCategory;
      const encryptedContent = prepareContent(dto.content, category);
      const embedding = await embeddingService.embed(dto.content); // embed plaintext
      const vectorLiteral = embeddingService.toVectorLiteral(embedding);
      sets.push(`content = $${idx++}`, `embedding = $${idx++}::vector`);
      params.push(encryptedContent, vectorLiteral);
    }
    if (dto.type !== undefined) { sets.push(`type = $${idx++}`); params.push(dto.type); }
    if (dto.tier !== undefined) { sets.push(`tier = $${idx++}`); params.push(dto.tier); }
    if (dto.category !== undefined) {
      const cat = dto.category as MemoryCategory;
      sets.push(`category = $${idx++}`); params.push(cat);
      // Auto-update is_shared when category changes to a shared category
      if (AUTO_SHARED_CATEGORIES.includes(cat)) {
        sets.push(`is_shared = TRUE`);
      }
    }
    if (dto.importance !== undefined) { sets.push(`importance = $${idx++}`); params.push(dto.importance); }
    if (dto.tags !== undefined) { sets.push(`tags = $${idx++}`); params.push(dto.tags); }
    if (dto.pinned !== undefined) { sets.push(`pinned = $${idx++}`); params.push(dto.pinned); }
    if (dto.is_shared !== undefined) { sets.push(`is_shared = $${idx++}`); params.push(dto.is_shared); }
    if (dto.metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(JSON.stringify(dto.metadata)); }

    if (sets.length === 0) return this.findById(userId, id);

    params.push(id, userId);
    const res = await query<Memory>(
      `UPDATE memories SET ${sets.join(', ')}
       WHERE id = $${idx++} AND user_id = $${idx}
       RETURNING ${MEMORY_COLS}`,
      params
    );

    if (res.rows[0]) {
      contextBundleService.invalidate(userId).catch(() => {});
    }

    return res.rows[0] ? decryptContent(res.rows[0], userId) : null;
  },

  async delete(userId: string, id: string): Promise<boolean> {
    // Get tier before delete to know if we need to invalidate bundle
    const mem = await this.findById(userId, id);
    const res = await query('DELETE FROM memories WHERE id = $1 AND user_id = $2', [id, userId]);
    const deleted = (res.rowCount ?? 0) > 0;

    if (deleted && mem && (mem.tier === 'core' || mem.tier === 'hot')) {
      contextBundleService.invalidate(userId).catch(() => {});
    }

    return deleted;
  },

  async addLink(
    userId: string,
    sourceId: string,
    target: { memoryId?: string; entityId?: string },
    linkType: string
  ): Promise<void> {
    // Verify source belongs to user
    const source = await this.findById(userId, sourceId);
    if (!source) throw Object.assign(new Error('Source memory not found'), { statusCode: 404 });

    await query(
      `INSERT INTO memory_links (source_id, target_memory_id, target_entity_id, link_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [sourceId, target.memoryId ?? null, target.entityId ?? null, linkType]
    );
  },

  async getLinks(userId: string, memoryId: string): Promise<Array<{
    id: string;
    link_type: string;
    target_memory?: { id: string; content: string; type: string };
    target_entity?: { name: string; type: string };
  }>> {
    const res = await query<{
      id: string;
      link_type: string;
      target_memory_id: string | null;
      target_entity_id: string | null;
      target_memory_content: string | null;
      target_memory_type: string | null;
      target_entity_name: string | null;
      target_entity_type: string | null;
    }>(
      `SELECT
         ml.id, ml.link_type,
         ml.target_memory_id,  ml.target_entity_id,
         tm.content AS target_memory_content, tm.type AS target_memory_type,
         te.name AS target_entity_name, te.type AS target_entity_type
       FROM memory_links ml
       JOIN memories src ON src.id = ml.source_id AND src.user_id = $1
       LEFT JOIN memories tm ON tm.id = ml.target_memory_id
       LEFT JOIN entities te ON te.id = ml.target_entity_id
       WHERE ml.source_id = $2`,
      [userId, memoryId]
    );

    return res.rows.map(r => ({
      id: r.id,
      link_type: r.link_type,
      ...(r.target_memory_id ? {
        target_memory: { id: r.target_memory_id, content: r.target_memory_content!, type: r.target_memory_type! },
      } : {}),
      ...(r.target_entity_id ? {
        target_entity: { name: r.target_entity_name!, type: r.target_entity_type! },
      } : {}),
    }));
  },

  async getStats(userId: string) {
    return contextBundleService.getStats(userId);
  },
};
