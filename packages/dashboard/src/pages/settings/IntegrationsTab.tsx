import { useState } from 'react';
import { getApiKey, getApiBase } from '../../api';
import type { SettingsTabProps } from './types';
import { FieldRow, SectionTitle, SaveBar } from './FieldRow';

const MCP_URL_HINT = 'Aktualny URL MCP serwera MemoryAI. Wklej do konfiguracji IDE.';

const IDE_CONFIGS = [
  { name: 'Claude Code', key: 'claude_code', snippet: (url: string, key: string) => JSON.stringify({ mcpServers: { memoryai: { type: 'http', url: `${url}/mcp`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
  { name: 'Cursor', key: 'cursor', snippet: (url: string, key: string) => JSON.stringify({ mcpServers: { memoryai: { url: `${url}/mcp`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
  { name: 'Windsurf', key: 'windsurf', snippet: (url: string, key: string) => JSON.stringify({ mcpServers: { memoryai: { serverUrl: `${url}/mcp`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
  { name: 'Antigravity', key: 'antigravity', snippet: (url: string, key: string) => JSON.stringify({ mcpServers: { memoryai: { serverUrl: `${url}/mcp/sse`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
];

export function IntegrationsTab({ config, setConfig, onSaveConfig, saving, saveMsg }: SettingsTabProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [owTest, setOwTest] = useState('');
  const [owTesting, setOwTesting] = useState(false);

  const apiBase = getApiBase().replace('/v1', '');
  const apiKey = getApiKey();

  const copy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const testOpenWebUI = async () => {
    const url = config['integration.openwebui.url'];
    if (!url) { setOwTest('Enter Open WebUI URL first'); return; }
    setOwTesting(true); setOwTest('');
    try {
      const r = await fetch(`${url.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(5000) });
      setOwTest(r.ok ? `✓ Connected (HTTP ${r.status})` : `✗ HTTP ${r.status}`);
    } catch (e) {
      setOwTest(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally { setOwTesting(false); }
  };

  const f = (key: string) => ({
    value: config[key] ?? '',
    onChange: (v: string) => setConfig(c => ({ ...c, [key]: v })),
  });

  return (
    <div style={{ maxWidth: 680 }}>

      {/* IDE Integrations */}
      <SectionTitle>IDE / MCP Clients</SectionTitle>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
        Skopiuj konfigurację do pliku ustawień swojego IDE lub uruchom automatyczny instalator.
      </p>
      <div style={{ marginBottom: 16 }}>
        <FieldRow label="MCP Server URL" hint={MCP_URL_HINT}
          value={apiBase ? `${apiBase}/mcp` : '(zaloguj się aby zobaczyć URL)'}
          onChange={() => {}} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {IDE_CONFIGS.map(ide => (
          <div key={ide.key} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{ide.name}</div>
            <pre style={{
              background: 'var(--bg3)', borderRadius: 6, padding: 8, fontSize: 10,
              overflow: 'auto', maxHeight: 80, margin: '0 0 8px',
            }}>
              {apiBase ? ide.snippet(apiBase, apiKey).slice(0, 200) + '…' : '(login required)'}
            </pre>
            <button className="btn btn-ghost btn-sm" style={{ width: '100%' }}
              onClick={() => apiBase && copy(ide.snippet(apiBase, apiKey), ide.key)}
              disabled={!apiBase}>
              {copied === ide.key ? '✓ Copied!' : 'Copy Config'}
            </button>
          </div>
        ))}
      </div>
      <a href={`${apiBase}/dashboard/install.py`} target="_blank" rel="noreferrer"
        className="btn btn-secondary btn-sm" style={{ display: 'inline-block', marginBottom: 24 }}>
        Auto-Installer Script ↗
      </a>

      {/* Open WebUI */}
      <SectionTitle>Open WebUI</SectionTitle>
      <FieldRow label="URL instancji" placeholder="http://localhost:3000" {...f('integration.openwebui.url')} />
      <FieldRow label="Bearer token" type="password" placeholder="(opcjonalny)" {...f('integration.openwebui.token')} />
      <FieldRow label="Maks. wspomnień per request" type="number" {...f('integration.openwebui.maxMemories')} />
      <FieldRow label="Min. score" hint="0.0–1.0, domyślnie 0.45" type="number" {...f('integration.openwebui.minScore')} />
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => void testOpenWebUI()} disabled={owTesting}>
          {owTesting ? 'Testing…' : 'Test Connection'}
        </button>
        {owTest && <span style={{ fontSize: 13, marginLeft: 12, color: owTest.startsWith('✓') ? '#68d391' : '#fc8181' }}>{owTest}</span>}
      </div>

      {/* n8n */}
      <SectionTitle>n8n</SectionTitle>
      <FieldRow label="URL serwera n8n" placeholder="https://n8n.twoj-serwer.com" {...f('integration.n8n.url')} />
      <FieldRow label="Webhook token" type="password" {...f('integration.n8n.webhookToken')} />

      {/* GitHub */}
      <SectionTitle>GitHub</SectionTitle>
      <FieldRow label="Personal Access Token" type="password" hint="Do operacji na repo z dashboardu" {...f('integration.github.token')} />

      {/* Webhooks */}
      <SectionTitle>Webhooki</SectionTitle>
      <FieldRow label="Po zapisaniu wspomnienia (URL)" hint="POST z {memory_id, content, type, user_id}" {...f('webhook.onMemorySave')} />
      <FieldRow label="Po dystylacji sesji (URL)" hint="POST z {session_id, memories_count, user_id}" {...f('webhook.onDistillation')} />

      {/* Tailscale — read only */}
      <SectionTitle>Tailscale (read-only)</SectionTitle>
      <div style={{ fontSize: 13, color: 'var(--text2)', background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
        <div>Serve URL: <code>{apiBase || '(niedostępne)'}</code></div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text3)' }}>
          Konfiguracja Tailscale wymaga dostępu SSH do serwera. Użyj <code>tailscale serve --bg 3001</code> lub <code>tailscale funnel --bg 3001</code>.
        </div>
      </div>

      <SaveBar onSave={onSaveConfig} saving={saving} msg={saveMsg} />
    </div>
  );
}
