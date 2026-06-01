import { query } from '../db/pool.js';

export interface AuditEntry {
  id: string;
  user_id: string;
  memory_id: string | null;
  operation: 'read' | 'write' | 'delete' | 'decrypt';
  category: string | null;
  content_preview: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export const auditService = {
  async log(opts: {
    userId: string;
    memoryId?: string;
    operation: AuditEntry['operation'];
    category?: string;
    contentPreview?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    // Fire-and-forget — never block the main flow
    query(
      `INSERT INTO audit_log (user_id, memory_id, operation, category, content_preview, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`,
      [
        opts.userId,
        opts.memoryId ?? null,
        opts.operation,
        opts.category ?? null,
        opts.contentPreview ? opts.contentPreview.slice(0, 60) : null,
        opts.ipAddress ?? null,
        opts.userAgent ?? null,
      ]
    ).catch((err: Error) => {
      process.stderr.write(`[audit] log failed: ${err.message}\n`);
    });
  },

  async list(userId: string, opts?: {
    limit?: number;
    offset?: number;
    operation?: AuditEntry['operation'];
  }): Promise<{ data: AuditEntry[]; total: number }> {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const offset = opts?.offset ?? 0;

    const conditions = ['user_id = $1'];
    const params: unknown[] = [userId];
    let idx = 2;

    if (opts?.operation) {
      conditions.push(`operation = $${idx++}`);
      params.push(opts.operation);
    }

    const where = conditions.join(' AND ');

    const [dataRes, countRes] = await Promise.all([
      query<AuditEntry>(
        `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM audit_log WHERE ${where}`,
        params
      ),
    ]);

    return {
      data: dataRes.rows,
      total: parseInt(countRes.rows[0].count, 10),
    };
  },
};
