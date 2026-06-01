import { useState, useEffect, useCallback } from 'react';
import {
  memoriesApi,
  type Memory,
  type MemoryTier,
  type MemoryType,
  type MemoryCategory,
  type CreateMemoryDto,
  ApiError,
} from '../api';
import { TierBadge, CategoryBadge, ImportanceBar } from '../components/Badge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';

const TIERS: MemoryTier[] = ['core', 'hot', 'warm', 'cold'];
const TYPES: MemoryType[] = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'];
const CATEGORIES: MemoryCategory[] = [
  'user_profile', 'meta_instructions', 'active_project', 'technical_stack',
  'preferences', 'workflow', 'domain_knowledge', 'decisions', 'constraints',
  'relationships', 'temporal', 'archive', 'infrastructure', 'credentials',
  'shared_config', 'general',
];

const PAGE_SIZE = 25;

const emptyForm: CreateMemoryDto = {
  content: '',
  type: 'fact',
  tier: 'warm',
  category: 'general',
  importance: 0.5,
  is_shared: false,
};

export function Memories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [filterTier, setFilterTier] = useState<MemoryTier | ''>('');
  const [filterCategory, setFilterCategory] = useState<MemoryCategory | ''>('');

  // Expanded rows
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Modal for detail view
  const [detailMemory, setDetailMemory] = useState<Memory | null>(null);

  // New memory form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateMemoryDto>(emptyForm);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await memoriesApi.list({
        limit: PAGE_SIZE,
        offset,
        tier: filterTier || undefined,
        category: filterCategory || undefined,
      });
      setMemories(result.data);
      setTotal(result.meta.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  }, [offset, filterTier, filterCategory]);

  useEffect(() => {
    void fetchMemories();
  }, [fetchMemories]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [filterTier, filterCategory]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory?')) return;
    try {
      await memoriesApi.delete(id);
      void fetchMemories();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Delete failed');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.content.trim()) { setFormError('Content is required'); return; }
    setFormLoading(true);
    setFormError('');
    try {
      await memoriesApi.create(form);
      setForm(emptyForm);
      setShowForm(false);
      setOffset(0);
      void fetchMemories();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed to create memory');
    } finally {
      setFormLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Client-side content search filter
  const displayed = search.trim()
    ? memories.filter(m => m.content.toLowerCase().includes(search.toLowerCase()))
    : memories;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Memories</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? '✕ Cancel' : '+ New Memory'}
        </button>
      </div>

      {showForm && (
        <div className="inline-form">
          <form onSubmit={handleCreate}>
            <div className="form-grid">
              <div className="form-group full-width">
                <label className="form-label">Content *</label>
                <textarea
                  rows={4}
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="Memory content…"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as MemoryType }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Tier</label>
                <select value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value as MemoryTier }))}>
                  {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as MemoryCategory }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Importance (0–1)</label>
                <input
                  type="number"
                  min={0} max={1} step={0.05}
                  value={form.importance}
                  onChange={e => setForm(f => ({ ...f, importance: parseFloat(e.target.value) }))}
                />
              </div>
              <div className="form-group" style={{ justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="is_shared"
                  checked={form.is_shared}
                  onChange={e => setForm(f => ({ ...f, is_shared: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                <label className="form-label" htmlFor="is_shared" style={{ margin: 0 }}>Shared across projects</label>
              </div>
            </div>
            {formError && <div className="error-banner" style={{ marginTop: 12 }}>{formError}</div>}
            <div className="form-row">
              <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setForm(emptyForm); }}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={formLoading}>
                {formLoading ? 'Saving…' : 'Create Memory'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search content…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={filterTier} onChange={e => setFilterTier(e.target.value as MemoryTier | '')}>
          <option value="">All tiers</option>
          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as MemoryCategory | '')}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={() => void fetchMemories()}>
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingSpinner />
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>🧠</div>
          <p>No memories found. Adjust filters or create a new memory.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Content</th>
                  <th>Tier</th>
                  <th>Category</th>
                  <th>Importance</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(m => (
                  <tr key={m.id}>
                    <td>
                      <div
                        className={`memory-content ${expanded.has(m.id) ? 'expanded' : ''}`}
                        onClick={() => toggleExpand(m.id)}
                        title={expanded.has(m.id) ? 'Click to collapse' : 'Click to expand'}
                      >
                        {m.content}
                      </div>
                      {m.pinned && (
                        <span style={{ fontSize: 11, color: 'var(--tier-hot)', marginTop: 2, display: 'block' }}>
                          📌 pinned
                        </span>
                      )}
                    </td>
                    <td><TierBadge tier={m.tier} /></td>
                    <td><CategoryBadge category={m.category} /></td>
                    <td><ImportanceBar value={m.importance} /></td>
                    <td style={{ color: 'var(--text3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(m.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="td-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          title="View detail"
                          onClick={() => setDetailMemory(m)}
                        >
                          ⤢
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => void handleDelete(m.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!search.trim() && (
            <Pagination
              total={total}
              limit={PAGE_SIZE}
              offset={offset}
              onChange={setOffset}
            />
          )}
        </>
      )}

      {detailMemory && (
        <Modal title="Memory Detail" onClose={() => setDetailMemory(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="form-label" style={{ marginBottom: 6 }}>Content</div>
              <div style={{
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '10px 14px',
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: 13,
                lineHeight: 1.6,
              }}>
                {detailMemory.content}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['ID', detailMemory.id],
                ['Type', detailMemory.type],
                ['Tier', <TierBadge key="t" tier={detailMemory.tier} />],
                ['Category', <CategoryBadge key="c" category={detailMemory.category} />],
                ['Importance', <ImportanceBar key="i" value={detailMemory.importance} />],
                ['Language', detailMemory.language],
                ['Pinned', detailMemory.pinned ? 'Yes' : 'No'],
                ['Shared', detailMemory.is_shared ? 'Yes' : 'No'],
                ['Access count', String(detailMemory.access_count)],
                ['Created', new Date(detailMemory.created_at).toLocaleString()],
                ['Updated', new Date(detailMemory.updated_at).toLocaleString()],
                ['Last accessed', detailMemory.last_accessed ? new Date(detailMemory.last_accessed).toLocaleString() : '—'],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <div className="form-label">{label}</div>
                  <div style={{ marginTop: 4, fontSize: 13, wordBreak: 'break-all' }}>{value}</div>
                </div>
              ))}
            </div>
            {detailMemory.tags.length > 0 && (
              <div>
                <div className="form-label" style={{ marginBottom: 6 }}>Tags</div>
                <div className="chips">
                  {detailMemory.tags.map(tag => <span key={tag} className="chip">{tag}</span>)}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button
                className="btn btn-danger"
                onClick={() => {
                  void handleDelete(detailMemory.id);
                  setDetailMemory(null);
                }}
              >
                Delete
              </button>
              <button className="btn btn-secondary" onClick={() => setDetailMemory(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
