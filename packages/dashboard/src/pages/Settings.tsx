import { useState, useEffect } from 'react';
import {
  getApiKey,
  setApiKey,
  getApiBase,
  setApiBase,
  adminApi,
  ApiError,
  API_KEY_STORAGE,
} from '../api';

interface Props {
  onLogout: () => void;
}

type ConfigState = Record<string, string>;

const CONFIG_FIELDS: { key: string; label: string; group: string; type?: string; options?: string[] }[] = [
  // Embedding
  { key: 'embedding.provider', label: 'Provider', group: 'Embedding Model', options: ['ollama', 'gemini', 'openai'] },
  { key: 'embedding.ollamaModel', label: 'Ollama model', group: 'Embedding Model' },
  { key: 'embedding.ollamaBaseUrl', label: 'Ollama base URL', group: 'Embedding Model' },
  { key: 'embedding.dimensions', label: 'Vector dimensions', group: 'Embedding Model' },
  { key: 'embedding.geminiApiKey', label: 'Gemini API key', group: 'Embedding Model', type: 'password' },
  { key: 'embedding.openaiApiKey', label: 'OpenAI API key', group: 'Embedding Model', type: 'password' },
  // Distillation
  { key: 'distillation.provider', label: 'Provider', group: 'Distillation Model', options: ['ollama', 'gemini', 'openai', 'anthropic'] },
  { key: 'distillation.model', label: 'Model name', group: 'Distillation Model' },
  { key: 'distillation.ollamaBaseUrl', label: 'Ollama base URL', group: 'Distillation Model' },
  { key: 'distillation.inactivityMinutes', label: 'Inactivity timeout (min)', group: 'Distillation Model' },
  { key: 'distillation.geminiApiKey', label: 'Gemini API key', group: 'Distillation Model', type: 'password' },
  { key: 'distillation.anthropicApiKey', label: 'Anthropic API key', group: 'Distillation Model', type: 'password' },
  { key: 'distillation.openaiApiKey', label: 'OpenAI API key', group: 'Distillation Model', type: 'password' },
  // Reranker
  { key: 'reranker.enabled', label: 'Enabled', group: 'Reranker', options: ['true', 'false'] },
  { key: 'reranker.model', label: 'Reranker model', group: 'Reranker' },
];

const GROUPS = ['Embedding Model', 'Distillation Model', 'Reranker'];

export function Settings({ onLogout }: Props) {
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [apiBase, setApiBaseState] = useState(getApiBase());
  const [showKey, setShowKey] = useState(false);
  const [connSaved, setConnSaved] = useState(false);

  const [config, setConfig] = useState<ConfigState>({});
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState('');
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const [vectorStatus, setVectorStatus] = useState('');
  const [vectorLoading, setVectorLoading] = useState(false);
  const [decayStatus, setDecayStatus] = useState('');
  const [decayLoading, setDecayLoading] = useState(false);
  const [dedupStatus, setDedupStatus] = useState('');
  const [dedupLoading, setDedupLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    adminApi.getConfig()
      .then(res => setConfig(res.data))
      .catch(() => setConfig({}))
      .finally(() => setConfigLoading(false));
  }, []);

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 6)}${'•'.repeat(Math.min(32, Math.max(0, apiKey.length - 10)))}${apiKey.slice(-4)}`
    : '';

  const handleSaveConnection = () => {
    setApiKey(apiKey);
    setApiBase(apiBase);
    setConnSaved(true);
    setTimeout(() => setConnSaved(false), 2000);
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    setConfigMsg('');
    try {
      await adminApi.updateConfig(config);
      setConfigMsg('Saved. Restart the API container to apply changes.');
    } catch (e) {
      setConfigMsg(`Error: ${e instanceof ApiError ? e.message : 'Failed'}`);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleCreateVectorIndex = async () => {
    setVectorLoading(true);
    setVectorStatus('');
    try {
      await adminApi.createVectorIndex();
      setVectorStatus('Vector index created successfully.');
    } catch (e) {
      setVectorStatus(`Error: ${e instanceof ApiError ? e.message : 'Failed'}`);
    } finally {
      setVectorLoading(false);
    }
  };

  const handleDecay = async () => {
    setDecayLoading(true);
    setDecayStatus('');
    try {
      const res = await adminApi.runDecay();
      setDecayStatus(`Done. ${res.data.total} memories demoted.`);
    } catch (e) {
      setDecayStatus(`Error: ${e instanceof ApiError ? e.message : 'Failed'}`);
    } finally {
      setDecayLoading(false);
    }
  };

  const handleDedup = async () => {
    setDedupLoading(true);
    setDedupStatus('');
    try {
      await adminApi.runDeduplication();
      setDedupStatus('Deduplication complete.');
    } catch (e) {
      setDedupStatus(`Error: ${e instanceof ApiError ? e.message : 'Failed'}`);
    } finally {
      setDedupLoading(false);
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    setExportError('');
    try {
      const res = await adminApi.exportMemories();
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { message?: string }).message ?? res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `memoryai-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* Connection */}
      <div className="settings-section">
        <h2>Connection</h2>
        <div className="form-group">
          <label className="form-label">API Key</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKeyState(e.target.value)}
              placeholder={maskedKey || 'Paste API key…'}
              style={{ flex: 1, fontFamily: 'monospace' }}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => setShowKey(v => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            Stored in <code>localStorage["{API_KEY_STORAGE}"]</code>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">API Base URL</label>
          <input
            type="text"
            value={apiBase}
            onChange={e => setApiBaseState(e.target.value)}
            placeholder="/v1"
          />
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Default: <code>/v1</code> (same-origin). Change for remote host, e.g. <code>https://dell.tailfbeb53.ts.net/v1</code>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleSaveConnection}>
          {connSaved ? '✓ Saved' : 'Save Connection'}
        </button>
      </div>

      {/* Model Configuration */}
      <div className="settings-section">
        <h2>Model Configuration</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
          Values saved here override the server's <code>.env</code> file. Restart the API container after saving to apply changes.
        </p>

        {configLoading ? (
          <div style={{ color: 'var(--text3)' }}>Loading config…</div>
        ) : (
          GROUPS.map(group => (
            <div key={group} style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {group}
              </h3>
              {CONFIG_FIELDS.filter(f => f.group === group).map(field => (
                <div key={field.key} className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label" style={{ fontSize: 12 }}>{field.label}</label>
                  {field.options ? (
                    <select
                      value={config[field.key] ?? ''}
                      onChange={e => setConfig(c => ({ ...c, [field.key]: e.target.value }))}
                      style={{ width: '100%' }}
                    >
                      {field.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type={field.type === 'password' && !showPasswords[field.key] ? 'password' : 'text'}
                        value={config[field.key] ?? ''}
                        onChange={e => setConfig(c => ({ ...c, [field.key]: e.target.value }))}
                        placeholder={field.type === 'password' ? '(not set)' : ''}
                        style={{ flex: 1, fontFamily: field.type === 'password' ? 'monospace' : undefined }}
                      />
                      {field.type === 'password' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setShowPasswords(p => ({ ...p, [field.key]: !p[field.key] }))}
                        >
                          {showPasswords[field.key] ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}

        <button
          className="btn btn-primary"
          onClick={() => void handleSaveConfig()}
          disabled={configSaving || configLoading}
        >
          {configSaving ? 'Saving…' : 'Save Model Config'}
        </button>
        {configMsg && (
          <div style={{ marginTop: 8, fontSize: 13, color: configMsg.startsWith('Error') ? '#fc8181' : '#68d391' }}>
            {configMsg}
          </div>
        )}
      </div>

      {/* Admin Actions */}
      <div className="settings-section">
        <h2>Admin Actions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          <div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
              <strong>Memory Decay</strong> — Demote unused memories: hot→warm (14d), warm→cold (60d, importance &lt;0.7). Runs automatically weekly.
            </div>
            <button className="btn btn-secondary" onClick={() => void handleDecay()} disabled={decayLoading}>
              {decayLoading ? 'Running…' : 'Run Decay Now'}
            </button>
            {decayStatus && <div style={{ marginTop: 6, fontSize: 13, color: decayStatus.startsWith('Error') ? '#fc8181' : '#68d391' }}>{decayStatus}</div>}
          </div>

          <div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
              <strong>Deduplication</strong> — Find and merge near-identical memories (similarity ≥0.95). Runs automatically weekly.
            </div>
            <button className="btn btn-secondary" onClick={() => void handleDedup()} disabled={dedupLoading}>
              {dedupLoading ? 'Running…' : 'Run Deduplication Now'}
            </button>
            {dedupStatus && <div style={{ marginTop: 6, fontSize: 13, color: dedupStatus.startsWith('Error') ? '#fc8181' : '#68d391' }}>{dedupStatus}</div>}
          </div>

          <div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
              <strong>Vector Index</strong> — Rebuild pgvector HNSW index for semantic search.
            </div>
            <button className="btn btn-secondary" onClick={() => void handleCreateVectorIndex()} disabled={vectorLoading}>
              {vectorLoading ? 'Creating…' : 'Rebuild Vector Index'}
            </button>
            {vectorStatus && <div style={{ marginTop: 6, fontSize: 13, color: vectorStatus.startsWith('Error') ? '#fc8181' : '#68d391' }}>{vectorStatus}</div>}
          </div>

          <div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
              <strong>Export</strong> — Download all memories as JSON.
            </div>
            <button className="btn btn-secondary" onClick={() => void handleExport()} disabled={exportLoading}>
              {exportLoading ? 'Exporting…' : 'Export All Memories'}
            </button>
            {exportError && <div style={{ marginTop: 6, fontSize: 13, color: '#fc8181' }}>{exportError}</div>}
          </div>
        </div>
      </div>

      {/* Session */}
      <div className="settings-section">
        <h2>Session</h2>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (confirm('Clear API key and log out?')) {
              localStorage.removeItem(API_KEY_STORAGE);
              onLogout();
            }
          }}
        >
          Log Out
        </button>
      </div>
    </div>
  );
}
