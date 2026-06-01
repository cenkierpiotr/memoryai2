import { Fragment, useState, useEffect, useCallback } from 'react';
import { adminApi, ApiError, type AuditEntry } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Pagination } from '../components/Pagination';

const PAGE_SIZE = 50;

const OPERATIONS = ['create', 'update', 'delete', 'search', 'access', 'export', 'distill'];

function OpBadge({ operation }: { operation: string }) {
  const op = operation.toLowerCase();
  let cls = 'op-default';
  if (op.includes('create') || op.includes('insert')) cls = 'op-create';
  else if (op.includes('update') || op.includes('patch')) cls = 'op-update';
  else if (op.includes('delete') || op.includes('remove')) cls = 'op-delete';
  else if (op.includes('search') || op.includes('query')) cls = 'op-search';
  return <span className={`op-badge ${cls}`}>{operation}</span>;
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterOp, setFilterOp] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await adminApi.auditLog({
        operation: filterOp || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setEntries(result.data);
      setTotal(result.meta?.total ?? result.data.length);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError('Admin access required to view the audit log.');
      } else if (e instanceof ApiError && e.status === 404) {
        setError('Audit log endpoint not available on this server.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to load audit log');
      }
    } finally {
      setLoading(false);
    }
  }, [offset, filterOp]);

  useEffect(() => { void fetchLog(); }, [fetchLog]);

  useEffect(() => { setOffset(0); }, [filterOp]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Audit Log</h1>
        <button className="btn btn-secondary btn-sm" onClick={() => void fetchLog()}>
          Refresh
        </button>
      </div>

      <div className="filter-bar">
        <select value={filterOp} onChange={e => setFilterOp(e.target.value)} style={{ minWidth: 180 }}>
          <option value="">All operations</option>
          {OPERATIONS.map(op => <option key={op} value={op}>{op}</option>)}
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingSpinner />
      ) : entries.length === 0 && !error ? (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>📋</div>
          <p>No audit log entries found.</p>
        </div>
      ) : !error ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 180 }}>Timestamp</th>
                  <th>Operation</th>
                  <th>Category</th>
                  <th>Memory Preview</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <Fragment key={entry.id}>
                    <tr>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                      <td><OpBadge operation={entry.operation} /></td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>
                        {entry.category ?? '—'}
                      </td>
                      <td style={{ maxWidth: 300 }}>
                        {entry.memory_content ? (
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 12,
                              color: 'var(--text2)',
                              cursor: 'pointer',
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: expandedId === entry.id ? 'pre-wrap' : 'nowrap',
                            }}
                            onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                            title="Click to expand"
                          >
                            {entry.memory_content}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text3)' }}>—</span>
                        )}
                      </td>
                      <td>
                        {entry.memory_id && (
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>
                            {entry.memory_id.slice(0, 8)}…
                          </span>
                        )}
                      </td>
                    </tr>
                    {expandedId === entry.id && Object.keys(entry.metadata ?? {}).length > 0 && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--bg3)', padding: '8px 14px' }}>
                          <pre style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text2)', margin: 0, overflowX: 'auto' }}>
                            {JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            total={total}
            limit={PAGE_SIZE}
            offset={offset}
            onChange={setOffset}
          />
        </>
      ) : null}
    </div>
  );
}
