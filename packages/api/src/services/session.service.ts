import { query, withTransaction } from '../db/pool.js';
import type { Session, SessionMessage, CreateSessionDto, AddMessageDto } from '@memoryai/shared';

export const sessionService = {
  async create(userId: string, dto: CreateSessionDto): Promise<Session> {
    const res = await query<Session>(
      `INSERT INTO sessions (user_id, project_id, title, model, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, project_id, title, model, status, message_count,
                 metadata, started_at, ended_at, distilled_at`,
      [userId, dto.project_id ?? null, dto.title ?? null, dto.model ?? null, JSON.stringify(dto.metadata ?? {})]
    );
    return res.rows[0];
  },

  async findById(userId: string, id: string): Promise<Session | null> {
    const res = await query<Session>(
      `SELECT id, user_id, project_id, title, model, status, message_count,
              metadata, started_at, ended_at, distilled_at
       FROM sessions WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return res.rows[0] ?? null;
  },

  async findByIdAny(id: string): Promise<Session | null> {
    const res = await query<Session>(
      `SELECT id, user_id, project_id, title, model, status, message_count,
              metadata, started_at, ended_at, distilled_at
       FROM sessions WHERE id = $1`,
      [id]
    );
    return res.rows[0] ?? null;
  },

  async list(userId: string, opts: { limit?: number; offset?: number; status?: string }): Promise<{
    data: Session[];
    total: number;
  }> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const offset = opts.offset ?? 0;

    const conditions = ['user_id = $1'];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (opts.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(opts.status);
    }

    const where = conditions.join(' AND ');

    const [dataRes, countRes] = await Promise.all([
      query<Session>(
        `SELECT id, user_id, project_id, title, model, status, message_count,
                metadata, started_at, ended_at, distilled_at
         FROM sessions WHERE ${where}
         ORDER BY started_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM sessions WHERE ${where}`,
        params
      ),
    ]);

    return { data: dataRes.rows, total: parseInt(countRes.rows[0].count, 10) };
  },

  async addMessage(userId: string, sessionId: string, dto: AddMessageDto): Promise<SessionMessage> {
    return withTransaction(async (client) => {
      // Verify session belongs to this user before inserting
      const sessionCheck = await client.query(
        'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId]
      );
      if (sessionCheck.rowCount === 0) {
        throw Object.assign(new Error('Session not found'), { statusCode: 404 });
      }

      const msgRes = await client.query<SessionMessage>(
        `INSERT INTO session_messages (session_id, role, content, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING id, session_id, role, content, metadata, created_at`,
        [sessionId, dto.role, dto.content, JSON.stringify(dto.metadata ?? {})]
      );

      await client.query(
        `UPDATE sessions SET message_count = message_count + 1 WHERE id = $1`,
        [sessionId]
      );

      return msgRes.rows[0];
    });
  },

  async getMessages(userId: string, sessionId: string, limit = 100): Promise<SessionMessage[]> {
    const res = await query<SessionMessage>(
      `SELECT sm.id, sm.session_id, sm.role, sm.content, sm.metadata, sm.created_at
       FROM session_messages sm
       JOIN sessions s ON s.id = sm.session_id
       WHERE sm.session_id = $1 AND s.user_id = $2
       ORDER BY sm.created_at ASC LIMIT $3`,
      [sessionId, userId, limit]
    );
    return res.rows;
  },

  async close(userId: string, sessionId: string): Promise<Session | null> {
    const res = await query<Session>(
      `UPDATE sessions SET status = 'closed', ended_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'active'
       RETURNING id, user_id, project_id, title, model, status, message_count,
                 metadata, started_at, ended_at, distilled_at`,
      [sessionId, userId]
    );
    return res.rows[0] ?? null;
  },

  async markDistilled(sessionId: string, memoriesCreated: number): Promise<void> {
    await query(
      `UPDATE sessions SET status = 'distilled', distilled_at = NOW() WHERE id = $1`,
      [sessionId]
    );
    await query(
      `UPDATE distillation_jobs SET status = 'done', memories_created = $1, finished_at = NOW()
       WHERE session_id = $2 AND status = 'running'`,
      [memoriesCreated, sessionId]
    );
  },

  // Find sessions that have been inactive for N minutes and need distillation
  async findStaleForDistillation(inactivityMinutes: number): Promise<Session[]> {
    const res = await query<Session>(
      `SELECT s.id, s.user_id, s.project_id, s.title, s.model, s.status, s.message_count,
              s.metadata, s.started_at, s.ended_at, s.distilled_at
       FROM sessions s
       WHERE s.status IN ('active', 'closed')
         AND s.message_count > 0
         AND NOT EXISTS (
           SELECT 1 FROM distillation_jobs dj
           WHERE dj.session_id = s.id AND dj.status IN ('pending','running','done')
         )
         AND (
           s.ended_at IS NOT NULL
           OR (
             SELECT MAX(created_at) FROM session_messages WHERE session_id = s.id
           ) < NOW() - INTERVAL '1 minute' * $1
         )`,
      [inactivityMinutes]
    );
    return res.rows;
  },
};
