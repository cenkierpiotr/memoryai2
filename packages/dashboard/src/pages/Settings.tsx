import { useState, useEffect } from 'react';
import { adminApi, ApiError, getApiKey, setApiKey, getApiBase, setApiBase, API_KEY_STORAGE } from '../api';
import { ProvidersTab } from './settings/ProvidersTab';
import { TasksTab } from './settings/TasksTab';
import { IntegrationsTab } from './settings/IntegrationsTab';
import { MemoryBehaviorTab } from './settings/MemoryBehaviorTab';
import { SecurityTab } from './settings/SecurityTab';
import { DangerZoneTab } from './settings/DangerZoneTab';
import type { ConfigState } from './settings/types';

interface Props { onLogout: () => void; }

type Tab = 'connection' | 'providers' | 'tasks' | 'integrations' | 'memory' | 'security' | 'danger' | 'admin';

const TABS: { id: Tab; label: string; danger?: boolean }[] = [
  { id: 'connection',   label: 'Połączenie' },
  { id: 'providers',    label: 'Dostawcy AI' },
  { id: 'tasks',        label: 'Zadania' },
  { id: 'integrations', label: 'Integracje' },
  { id: 'memory',       label: 'Pamięć' },
  { id: 'security',     label: 'Bezpieczeństwo' },
  { id: 'admin',        label: 'Admin' },
  { id: 'danger',       label: '⚠ Danger Zone', danger: true },
];

export function Settings({ onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('connection');

  // Connection
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [apiBase, setApiBaseState] = useState(getApiBase());
  const [showKey, setShowKey] = useState(false);
  const [connSaved, setConnSaved] = useState(false);

  // Config
  const [config, setConfig] = useState<ConfigState>({});
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState('');

  // Admin actions
  const [actionStatus, setActionStatus] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    adminApi.getConfig().then(r => setConfig(r.data)).catch(() => {}).finally(() => setConfigLoading(false));
  }, []);

  const handleSaveConnection = () => {
    setApiKey(apiKey); setApiBase(apiBase);
    setConnSaved(true); setTimeout(() => setConnSaved(false), 2000);
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true); setConfigMsg('');
    try {
      await adminApi.updateConfig(config);
      setConfigMsg('Saved. Restart API container to apply changes.');
    } catch (e) {
      setConfigMsg(`Error: ${e instanceof ApiError ? e.message : 'Failed'}`);
    } finally { setConfigSaving(false); }
  };

  const action = async (key: string, fn: () => Promise<string>) => {
    setActionLoading(l => ({ ...l, [key]: true }));
    setActionStatus(s => ({ ...s, [key]: '' }));
    try {
      const msg = await fn();
      setActionStatus(s => ({ ...s, [key]: msg }));
    } catch (e) {
      setActionStatus(s => ({ ...s, [key]: `Error: ${e instanceof ApiError ? e.message : String(e)}` }));
    } finally {
      setActionLoading(l => ({ ...l, [key]: false }));
    }
  };

  const tabProps = {
    config, setConfig,
    onSaveConfig: handleSaveConfig,
    saving: configSaving,
    saveMsg: configMsg,
  };

  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}${'•'.repeat(Math.min(28, apiKey.length - 10))}${apiKey.slice(-4)}` : '';

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h1 className="page-title">Settings</h1>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 24, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
            color: t.danger ? (tab === t.id ? '#fc8181' : 'var(--text3)') : (tab === t.id ? 'var(--accent)' : 'var(--text2)'),
            borderBottom: tab === t.id ? `2px solid ${t.danger ? '#fc8181' : 'var(--accent)'}` : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Connection */}
      {tab === 'connection' && (
        <div style={{ maxWidth: 520 }}>
          <div className="settings-section">
            <h2>API Key</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input type={showKey ? 'text' : 'password'} value={apiKey}
                onChange={e => setApiKeyState(e.target.value)}
                placeholder={maskedKey || 'Paste API key…'}
                style={{ flex: 1, fontFamily: 'monospace' }} />
              <button className="btn btn-ghost btn-sm" onClick={() => setShowKey(v => !v)}>{showKey ? 'Hide' : 'Show'}</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Stored in <code>localStorage["{API_KEY_STORAGE}"]</code></div>
          </div>
          <div className="settings-section">
            <h2>API Base URL</h2>
            <input value={apiBase} onChange={e => setApiBaseState(e.target.value)} placeholder="/v1" style={{ width: '100%', marginBottom: 6 }} />
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              Default: <code>/v1</code>. For remote: <code>https://dell.tailfbeb53.ts.net/v1</code>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleSaveConnection}>{connSaved ? '✓ Saved' : 'Save Connection'}</button>
        </div>
      )}

      {/* Providers */}
      {tab === 'providers' && <ProvidersTab />}

      {/* Tasks */}
      {tab === 'tasks' && !configLoading && <TasksTab {...tabProps} />}

      {/* Integrations */}
      {tab === 'integrations' && !configLoading && <IntegrationsTab {...tabProps} />}

      {/* Memory behavior */}
      {tab === 'memory' && !configLoading && <MemoryBehaviorTab {...tabProps} />}

      {/* Security */}
      {tab === 'security' && !configLoading && <SecurityTab {...tabProps} />}

      {/* Admin actions */}
      {tab === 'admin' && (
        <div style={{ maxWidth: 600 }}>
          {[
            { key: 'decay',    label: 'Memory Decay',    desc: 'Przenosi nieużywane wspomnienia hot→warm (14d), warm→cold (60d). Uruchamia się automatycznie co tydzień.',  fn: async () => { const r = await adminApi.runDecay(); return `Done. ${r.data.total} memories demoted.`; } },
            { key: 'dedup',    label: 'Deduplication',   desc: 'Scala prawie identyczne wspomnienia (similarity ≥0.95). Uruchamia się automatycznie co tydzień.',          fn: async () => { await adminApi.runDeduplication(); return 'Deduplication complete.'; } },
            { key: 'vecidx',  label: 'Rebuild Vector Index', desc: 'Przebudowuje indeks HNSW dla wyszukiwania semantycznego.',                                          fn: async () => { await adminApi.createVectorIndex(); return 'Vector index rebuilt.'; } },
            { key: 'export',   label: 'Export Memories',  desc: 'Pobierz wszystkie wspomnienia jako JSON.',                                                               fn: async () => { const r = await adminApi.exportMemories(); if (!r.ok) throw new Error(r.statusText); const b = await r.blob(); const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = `memoryai-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); return 'Downloaded.'; } },
          ].map(item => (
            <div key={item.key} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 12, background: 'var(--bg2)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{item.desc}</div>
              <button className="btn btn-secondary btn-sm" onClick={() => void action(item.key, item.fn)} disabled={actionLoading[item.key]}>
                {actionLoading[item.key] ? 'Running…' : 'Run Now'}
              </button>
              {actionStatus[item.key] && (
                <span style={{ fontSize: 13, marginLeft: 12, color: actionStatus[item.key].startsWith('Error') ? '#fc8181' : '#68d391' }}>
                  {actionStatus[item.key]}
                </span>
              )}
            </div>
          ))}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Session</div>
            <button className="btn btn-danger" onClick={() => { if (confirm('Log out?')) { localStorage.removeItem(API_KEY_STORAGE); onLogout(); } }}>
              Log Out
            </button>
          </div>
        </div>
      )}

      {/* Danger Zone */}
      {tab === 'danger' && !configLoading && <DangerZoneTab {...tabProps} />}

      {configLoading && (tab !== 'connection' && tab !== 'providers' && tab !== 'admin') && (
        <div style={{ color: 'var(--text3)' }}>Loading config…</div>
      )}
    </div>
  );
}
