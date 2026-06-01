import { useState } from 'react';
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

export function Settings({ onLogout }: Props) {
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [apiBase, setApiBaseState] = useState(getApiBase());
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const [vectorStatus, setVectorStatus] = useState('');
  const [vectorLoading, setVectorLoading] = useState(false);

  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 6)}${'•'.repeat(Math.min(32, Math.max(0, apiKey.length - 10)))}${apiKey.slice(-4)}`
    : '';

  const handleSave = () => {
    setApiKey(apiKey);
    setApiBase(apiBase);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCreateVectorIndex = async () => {
    setVectorLoading(true);
    setVectorStatus('');
    try {
      await adminApi.createVectorIndex();
      setVectorStatus('Vector index created successfully.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setVectorStatus('Error: Admin access required.');
      } else {
        setVectorStatus(`Error: ${e instanceof ApiError ? e.message : 'Failed'}`);
      }
    } finally {
      setVectorLoading(false);
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
      const contentType = res.headers.get('content-type') ?? 'application/json';
      const ext = contentType.includes('json') ? 'json' : 'bin';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `memoryai-export-${new Date().toISOString().slice(0, 10)}.${ext}`;
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
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* API Key */}
      <div className="settings-section">
        <h2>API Key</h2>
        <div className="key-display">
          <span className="key-value">
            {showKey ? apiKey : maskedKey || '(not set)'}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowKey(v => !v)}
          >
            {showKey ? 'Hide' : 'Reveal'}
          </button>
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Change API Key</label>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKeyState(e.target.value)}
            placeholder="Paste new API key…"
            style={{ width: '100%', fontFamily: 'monospace' }}
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
          Stored in <code style={{ fontFamily: 'monospace' }}>localStorage["{API_KEY_STORAGE}"]</code>
        </div>
      </div>

      {/* API Base */}
      <div className="settings-section">
        <h2>API Base URL</h2>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={apiBase}
            onChange={e => setApiBaseState(e.target.value)}
            placeholder="/v1"
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
            Default: <code>/v1</code> (same-origin). Change if using a different host.
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>

      {/* Admin actions */}
      <div className="settings-section">
        <h2>Admin Actions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--text2)' }}>
              Create or rebuild the pgvector index for semantic search.
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => void handleCreateVectorIndex()}
              disabled={vectorLoading}
            >
              {vectorLoading ? 'Creating…' : 'Create Vector Index'}
            </button>
            {vectorStatus && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: vectorStatus.startsWith('Error') ? '#fc8181' : '#68d391',
                }}
              >
                {vectorStatus}
              </div>
            )}
          </div>

          <div>
            <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--text2)' }}>
              Export all memories as JSON. Downloads automatically.
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => void handleExport()}
              disabled={exportLoading}
            >
              {exportLoading ? 'Exporting…' : 'Export All Memories'}
            </button>
            {exportError && (
              <div className="error-banner" style={{ marginTop: 8 }}>{exportError}</div>
            )}
          </div>
        </div>
      </div>

      {/* Logout */}
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
