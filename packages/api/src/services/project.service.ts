import { query } from '../db/pool.js';
import type { Project, CreateProjectDto, UpdateProjectDto } from '@memoryai/shared';

export const projectService = {
  /**
   * Resolve any project name or alias to its UUID.
   * Matches: exact name, any alias, or partial git_remote URL — all case-insensitive.
   */
  async resolveByName(userId: string, nameOrAlias: string): Promise<string | null> {
    const res = await query<{ id: string }>(
      'SELECT resolve_project($1, $2) AS id',
      [userId, nameOrAlias]
    );
    return res.rows[0]?.id ?? null;
  },

  async create(userId: string, dto: CreateProjectDto): Promise<Project> {
    const res = await query<Project>(
      `INSERT INTO projects (user_id, name, aliases, git_remote, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        dto.name,
        dto.aliases ?? [],
        dto.git_remote ?? null,
        dto.description ?? null,
        JSON.stringify(dto.metadata ?? {}),
      ]
    );
    return res.rows[0];
  },

  async list(userId: string): Promise<Project[]> {
    const res = await query<Project>(
      'SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return res.rows;
  },

  async findById(userId: string, id: string): Promise<Project | null> {
    const res = await query<Project>(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return res.rows[0] ?? null;
  },

  async update(userId: string, id: string, dto: UpdateProjectDto): Promise<Project | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) { sets.push(`name = $${idx++}`); params.push(dto.name); }
    if (dto.aliases !== undefined) { sets.push(`aliases = $${idx++}`); params.push(dto.aliases); }
    if (dto.git_remote !== undefined) { sets.push(`git_remote = $${idx++}`); params.push(dto.git_remote); }
    if (dto.description !== undefined) { sets.push(`description = $${idx++}`); params.push(dto.description); }
    if (dto.metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(JSON.stringify(dto.metadata)); }

    if (sets.length === 0) return this.findById(userId, id);

    params.push(id, userId);
    const res = await query<Project>(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
      params
    );
    return res.rows[0] ?? null;
  },

  async addAliases(userId: string, id: string, newAliases: string[]): Promise<Project | null> {
    const res = await query<Project>(
      `UPDATE projects
       SET aliases = (
         SELECT ARRAY(SELECT DISTINCT unnest(aliases || $1))
       )
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [newAliases, id, userId]
    );
    return res.rows[0] ?? null;
  },

  async delete(userId: string, id: string): Promise<boolean> {
    const res = await query(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (res.rowCount ?? 0) > 0;
  },
};
