import { useState, useEffect } from 'react';
import { adminApi, ApiError } from '../../api';
import type { Provider } from './types';
import { Modal } from '../../components/Modal';

const TYPES = ['ollama', 'openai', 'anthropic', 'gemini', 'custom'] as const;
type ProviderType = typeof TYPES[number];

const TYPE_DEFAULTS: Record<ProviderType, string> = {
  ollama:    'http://localhost:11434',
  openai:    'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini:    'https://generativelanguage.googleapis.com',
  custom:    '',
};

const empty = { name: '', provider_type: 'ollama' as ProviderType, base_url: TYPE_DEFAULTS.ollama, api_key: '', models: '', notes: '', is_active: true };

export function ProvidersTab() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listProviders();
      setProviders(r.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const openCreate = () => {
    setForm(empty); setFormErr(''); setCreating(true); setEditing(null);
  };

  const openEdit = (p: Provider) => {
    setForm({
      name: p.name, provider_type: p.provider_type as ProviderType,
      base_url: p.base_url, api_key: '', notes: p.notes ?? '',
      models: p.models.join(', '), is_active: p.is_active,
    });
    setFormErr(''); setEditing(p); setCreating(false);
  };

  const handleTypeChange = (t: ProviderType) => {
    setForm(f => ({ ...f, provider_type: t, base_url: TYPE_DEFAULTS[t] || f.base_url }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.base_url.trim()) { setFormErr('Name and Base URL are required'); return; }
    setFormSaving(true); setFormErr('');
    const dto: Record<string, unknown> = {
      name: form.name, provider_type: form.provider_type,
      base_url: form.base_url, notes: form.notes || undefined, is_active: form.is_active,
      models: form.models ? form.models.split(',').map(s => s.trim()).filter(Boolean) : [],
    };
    if (form.api_key) dto.api_key = form.api_key;
    try {
      if (editing) await adminApi.updateProvider(editing.id, dto);
      else await adminApi.createProvider(dto);
      setCreating(false); setEditing(null);
      void load();
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : 'Failed to save');
    } finally { setFormSaving(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete provider "${name}"?`)) return;
    await adminApi.deleteProvider(id);
    void load();
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const r = await adminApi.testProvider(id);
      setTestResults(t => ({ ...t, [id]: r.data }));
    } catch (e) {
      setTestResults(t => ({ ...t, [id]: { ok: false, message: String(e) } }));
    } finally { setTesting(null); }
  };

  const formModal = (
    <Modal title={editing ? `Edit: ${editing.name}` : 'New Provider'} onClose={() => { setCreating(false); setEditing(null); }}>
      <form onSubmit={handleSave}>
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My OpenAI, Ollama Dell…" />
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select value={form.provider_type} onChange={e => handleTypeChange(e.target.value as ProviderType)}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Base URL *</label>
          <input value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} placeholder="https://api.openai.com" />
        </div>
        <div className="form-group">
          <label className="form-label">API Key {editing && <span style={{ fontSize: 11, color: 'var(--text3)' }}>(leave blank to keep current)</span>}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type={showKey['form'] ? 'text' : 'password'} value={form.api_key}
              onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
              placeholder={editing ? '••••••••' : 'sk-...'} style={{ flex: 1, fontFamily: 'monospace' }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowKey(k => ({ ...k, form: !k.form }))}>
              {showKey['form'] ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Models <span style={{ fontSize: 11, color: 'var(--text3)' }}>(comma-separated, or auto-detect via Test)</span></label>
          <input value={form.models} onChange={e => setForm(f => ({ ...f, models: e.target.value }))}
            placeholder="gpt-4o, gpt-4o-mini, gpt-3.5-turbo" />
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="checkbox" id="prov_active" checked={form.is_active}
            onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ width: 16, height: 16 }} />
          <label htmlFor="prov_active" className="form-label" style={{ margin: 0 }}>Active</label>
        </div>
        {formErr && <div className="error-banner" style={{ marginBottom: 12 }}>{formErr}</div>}
        <div className="form-row">
          <button type="button" className="btn btn-secondary" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={formSaving}>{formSaving ? 'Saving…' : 'Save Provider'}</button>
        </div>
      </form>
    </Modal>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: 0 }}>
          Zarządzaj dostawcami AI. Każdy dostawca może być przypisany do konkretnych zadań w zakładce <strong>Zadania</strong>.
        </p>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Add Provider</button>
      </div>

      {loading ? <div style={{ color: 'var(--text3)' }}>Loading…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {providers.map(p => {
            const test = testResults[p.id];
            return (
              <div key={p.id} style={{
                border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px',
                background: p.is_active ? 'var(--bg2)' : 'var(--bg1)',
                opacity: p.is_active ? 1 : 0.6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {p.name}
                      {!p.is_active && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>disabled</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                      <span style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4, marginRight: 8 }}>{p.provider_type}</span>
                      {p.base_url}
                    </div>
                    {p.api_key && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>API key: {p.api_key}</div>}
                    {p.models.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                        Models: {p.models.slice(0, 5).join(', ')}{p.models.length > 5 ? ` +${p.models.length - 5}` : ''}
                      </div>
                    )}
                    {test && (
                      <div style={{ fontSize: 12, marginTop: 6, color: test.ok ? '#68d391' : '#fc8181' }}>
                        {test.ok ? '✓' : '✗'} {test.message}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => void handleTest(p.id)} disabled={testing === p.id}>
                      {testing === p.id ? '…' : 'Test'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(p.id, p.name)}>Del</button>
                  </div>
                </div>
              </div>
            );
          })}
          {providers.length === 0 && (
            <div className="empty-state"><p>No providers configured. Add one to get started.</p></div>
          )}
        </div>
      )}

      {(creating || editing) && formModal}
    </div>
  );
}
