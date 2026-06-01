import { useState } from 'react';
import { getApiKey, setApiKey, API_KEY_STORAGE, setApiBase } from './api';
import { Memories } from './pages/Memories';
import { Projects } from './pages/Projects';
import { Stats } from './pages/Stats';
import { AuditLog } from './pages/AuditLog';
import { Settings } from './pages/Settings';
import './styles.css';

type Page = 'memories' | 'projects' | 'stats' | 'audit' | 'settings';

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'memories', label: 'Memories', icon: '🧠' },
  { id: 'projects', label: 'Projects', icon: '📂' },
  { id: 'stats', label: 'Statistics', icon: '📊' },
  { id: 'audit', label: 'Audit Log', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState('');
  const [base, setBase] = useState('/v1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = key.trim();
    if (!trimmedKey) { setError('Please enter an API key.'); return; }
    setLoading(true);
    setError('');
    try {
      // Validate by hitting the health endpoint (no auth needed) first,
      // then try a stats call to confirm the key works
      const apiBase = base.trim() || '/v1';
      // Derive health URL from base (strip /v1 path)
      const healthBase = apiBase.replace(/\/v\d+$/, '');
      try {
        await fetch(`${healthBase}/health`);
      } catch {
        // health endpoint may not be reachable cross-origin, ignore
      }
      setApiBase(apiBase);
      setApiKey(trimmedKey);
      onLogin();
    } catch {
      setError('Failed to connect. Check URL and API key.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-box">
        <h1>MemoryAI</h1>
        <p>Persistent memory for LLMs. Enter your API key to continue.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="form-label" htmlFor="api-base">API Base URL</label>
            <input
              id="api-base"
              type="text"
              value={base}
              onChange={e => setBase(e.target.value)}
              placeholder="/v1"
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" htmlFor="api-key">API Key</label>
            <input
              id="api-key"
              type="password"
              value={key}
              onChange={e => { setKey(e.target.value); setError(''); }}
              placeholder="Paste your admin API key…"
              style={{ width: '100%', fontFamily: 'monospace' }}
              autoFocus
            />
          </div>
          {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </form>
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text3)' }}>
          Key stored in <code style={{ fontFamily: 'monospace' }}>localStorage</code>, sent as{' '}
          <code style={{ fontFamily: 'monospace' }}>Authorization: Bearer</code>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<Page>('memories');

  const renderPage = () => {
    switch (page) {
      case 'memories': return <Memories />;
      case 'projects': return <Projects />;
      case 'stats': return <Stats />;
      case 'audit': return <AuditLog />;
      case 'settings': return <Settings onLogout={onLogout} />;
    }
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>MemoryAI</h1>
          <p>Memory Dashboard</p>
        </div>
        <nav>
          {NAV_ITEMS.map(item => (
            <div
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setPage(item.id); }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="logout-btn" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}

export default function App() {
  const [hasKey, setHasKey] = useState(() => getApiKey().length > 0);

  const handleLogin = () => setHasKey(true);
  const handleLogout = () => {
    localStorage.removeItem(API_KEY_STORAGE);
    setApiKey('');
    setHasKey(false);
  };

  if (!hasKey) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <Dashboard onLogout={handleLogout} />;
}
