import { useState, useEffect, useCallback, useRef } from 'react';
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
  content: '', type: 'fact', tier: 'warm', category: 'general', importance: 0.5, is_shared: false,
};

export function Memories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [filterTier, setFilterTier] = useState<MemoryTier | ''>('');
  const [filterCategory, setFilterCategory] = useState<MemoryCategory | ''>('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateMemoryDto>(emptyForm);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const [editMemory, setEditMemory] = useState<Memory | null>(null);
  const [editForm, setEditForm] = useState<Partial<CreateMemoryDto>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  const [detailMemory, setDetailMemory] = useState<Memory | null>(null);

  // ── Fetch (list or search) ──────────────────────────────────

  const fetchList = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await memoriesApi.list({
        limit: PAGE_SIZE, offset,
        tier: filterTier || undefined,
        category: filterCategory || undefined,
      });
      setMemories(result.data);
      setTotal(result.meta.total);
      setIsSearchMode(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load memories');
    } finally { setLoading(false); }
  }, [offset, filterTier, filterCategory]);

  const fetchSearch = useCallback(async (q: string) => {
    if (!q.trim()) { void fetchList(); return; }
    setLoading(true); setError('');
    try {
      const result = await memoriesApi.search(q, { limit: 50 });
      setMemories(result.data);
      setTotal(result.data.length);
      setIsSearchMode(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Search failed');
    } finally { setLoading(false); }
  }, [fetchList]);

  useEffect(() => { void fetchList(); }, [fetchList]);
  useEffect(() => { setOffset(0); }, [filterTier, filterCategory]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!val.trim()) { void fetchList(); return; }
    searchTimeout.current = setTimeout(() => void fetchSearch(val), 400);
  };

  // ── Create ──────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.content.trim()) { setFormError('Content is required'); return; }
    setFormLoading(true); setFormError('');
    try {
      await memoriesApi.create(form);
      setForm(emptyForm); setShowForm(false); setOffset(0);
      void fetchList();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed to create');
    } finally { setFormLoading(false); }
  };

  // ── Edit ────────────────────────────────────────────────────

  const openEdit = (m: Memory) => {
    setEditMemory(m);
    setEditForm({
      content: m.content, type: m.type, tier: m.tier,
      category: m.category, importance: m.importance,
      is_shared: m.is_shared,
    });
    setEditError('');
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMemory) return;
    if (!editForm.content?.trim()) { setEditError('Content is required'); return; }
    setEditLoading(true); setEditError('');
    try {
      await memoriesApi.update(editMemory.id, editForm);
      setEditMemory(null);
      if (isSearchMode) void fetchSearch(search); else void fetchList();
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Update failed');
    } finally { setEditLoading(false); }
  };

  // ── Delete ──────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory?')) return;
    try {
      await memoriesApi.delete(id);
      if (detailMemory?.id === id) setDetailMemory(null);
      if (isSearchMode) void fetchSearch(search); else void fetchList();
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Delete failed'); }
  };

  // ── Form helper ─────────────────────────────────────────────

  const MemoryFormFields = ({ val, set }: {
    val: Partial<CreateMemoryDto>;
    set: (fn: (v: Partial<CreateMemoryDto>) => Partial<CreateMemoryDto>) => void;
  }) => (
    <div className="form-grid">
      <div className="form-group full-width">
        <label className="form-label">Content *</label>
        <textarea rows={4} value={val.content ?? ''} style={{ width: '100%' }}
          onChange={e => set(f => ({ ...f, content: e.target.value }))} />
      </div>
      <div className="form-group">
        <label className="form-label">Type</label>
        <select value={val.type ?? 'fact'} onChange={e => set(f => ({ ...f, type: e.target.value as MemoryType }))}>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Tier</label>
        <select value={val.tier ?? 'warm'} onChange={e => set(f => ({ ...f, tier: e.target.value as MemoryTier }))}>
          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Category</label>
        <select value={val.category ?? 'general'} onChange={e => set(f => ({ ...f, category: e.target.value as MemoryCategory }))}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Importance (0–1)</label>
        <input type="number" min={0} max={1} step={0.05} value={val.importance ?? 0.5}
          onChange={e => set(f => ({ ...f, importance: parseFloat(e.target.value) }))} />
      </div>
      <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id="shared_chk" style={{ width: 16, height: 16 }}
          checked={val.is_shared ?? false}
          onChange={e => set(f => ({ ...f, is_shared: e.target.checked }))} />
        <label className="form-label" htmlFor="shared_chk" style={{ margin: 0 }}>Shared across projects</label>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Memories <span style={{ fontSize: 14, color: 'var(--text3)', fontWeight: 400 }}>({total})</span></h1>
        <button className="btn btn-primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? '✕ Cancel' : '+ New Memory'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="inline-form">
          <form onSubmit={handleCreate}>
            <MemoryFormFields val={form} set={fn => setForm(f => fn(f) as CreateMemoryDto)} />
            {formError && <div className="error-banner" style={{ marginTop: 12 }}>{formError}</div>}
            <div className="form-row">
              <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setForm(emptyForm); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={formLoading}>{formLoading ? 'Saving…' : 'Create Memory'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <input type="search" placeholder="Search all memories (semantic)…"
          value={search} onChange={e => handleSearchChange(e.target.value)} />
        {!isSearchMode && <>
          <select value={filterTier} onChange={e => setFilterTier(e.target.value as MemoryTier | '')}>
            <option value="">All tiers</option>
            {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as MemoryCategory | '')}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </>}
        {isSearchMode && (
          <button className="btn btn-secondary btn-sm" onClick={() => { setSearch(''); void fetchList(); }}>
            ✕ Clear search
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => isSearchMode ? void fetchSearch(search) : void fetchList()}>
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? <LoadingSpinner /> : memories.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>🧠</div>
          <p>{isSearchMode ? 'No memories matched your search.' : 'No memories found. Adjust filters or create a new memory.'}</p>
        </div>
      ) : (
        <>
          {isSearchMode && <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>Semantic search — {memories.length} results</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '42%' }}>Content</th>
                  <th>Tier</th>
                  <th>Category</th>
                  <th>Importance</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {memories.map(m => (
                  <tr key={m.id}>
                    <td>
                      <div className="memory-content" onClick={() => setDetailMemory(m)} title="Click to view detail" style={{ cursor: 'pointer' }}>
                        {m.content}
                      </div>
                      {m.pinned && <span style={{ fontSize: 11, color: 'var(--tier-hot)', display: 'block' }}>📌 pinned</span>}
                    </td>
                    <td><TierBadge tier={m.tier} /></td>
                    <td><CategoryBadge category={m.category} /></td>
                    <td><ImportanceBar value={m.importance} /></td>
                    <td style={{ color: 'var(--text3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(m.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => openEdit(m)}>✏️</button>
                        <button className="btn btn-ghost btn-sm" title="View detail" onClick={() => setDetailMemory(m)}>⤢</button>
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(m.id)}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isSearchMode && (
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          )}
        </>
      )}

      {/* Edit modal */}
      {editMemory && (
        <Modal title="Edit Memory" onClose={() => setEditMemory(null)}>
          <form onSubmit={handleEdit}>
            <MemoryFormFields val={editForm} set={fn => setEditForm(f => fn(f))} />
            {editError && <div className="error-banner" style={{ marginTop: 12 }}>{editError}</div>}
            <div className="form-row" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditMemory(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={editLoading}>{editLoading ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Detail modal */}
      {detailMemory && (
        <Modal title="Memory Detail" onClose={() => setDetailMemory(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="form-label" style={{ marginBottom: 6 }}>Content</div>
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}>
                {detailMemory.content}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {([
                ['ID', detailMemory.id],
                ['Type', detailMemory.type],
                ['Tier', <TierBadge key="t" tier={detailMemory.tier} />],
                ['Category', <CategoryBadge key="c" category={detailMemory.category} />],
                ['Importance', <ImportanceBar key="i" value={detailMemory.importance} />],
                ['Pinned', detailMemory.pinned ? 'Yes' : 'No'],
                ['Shared', detailMemory.is_shared ? 'Yes' : 'No'],
                ['Access count', String(detailMemory.access_count)],
                ['Created', new Date(detailMemory.created_at).toLocaleString()],
                ['Last accessed', detailMemory.last_accessed ? new Date(detailMemory.last_accessed).toLocaleString() : '—'],
              ] as [string, React.ReactNode][]).map(([label, value]) => (
                <div key={label}>
                  <div className="form-label">{label}</div>
                  <div style={{ marginTop: 4, fontSize: 13, wordBreak: 'break-all' }}>{value}</div>
                </div>
              ))}
            </div>
            {detailMemory.tags.length > 0 && (
              <div>
                <div className="form-label" style={{ marginBottom: 6 }}>Tags</div>
                <div className="chips">{detailMemory.tags.map(tag => <span key={tag} className="chip">{tag}</span>)}</div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button className="btn btn-secondary" onClick={() => { openEdit(detailMemory); setDetailMemory(null); }}>Edit</button>
              <button className="btn btn-danger" onClick={() => { void handleDelete(detailMemory.id); setDetailMemory(null); }}>Delete</button>
              <button className="btn btn-secondary" onClick={() => setDetailMemory(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
