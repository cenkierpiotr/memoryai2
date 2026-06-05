import { useState } from 'react';
import type { SettingsTabProps } from './types';
import { adminApi, ApiError, API_KEY_STORAGE, setApiKey, setApiBase } from '../../api';
import { Modal } from '../../components/Modal';

interface DangerField {
  key: string;
  label: string;
  warning: string;
  requiresRestart: boolean;
  catastrophic?: boolean;
}

const FIELDS: DangerField[] = [
  {
    key: 'db.url',
    label: 'Database URL',
    warning: 'Zmiana wymaga restartu. Błędna wartość uniemożliwi uruchomienie API i może spowodować utratę dostępu do danych.',
    requiresRestart: true,
  },
  {
    key: 'redis.url',
    label: 'Redis URL',
    warning: 'Zmiana wymaga restartu. Błędna wartość zatrzyma kolejkę dystylacji i rate limiting.',
    requiresRestart: true,
  },
  {
    key: 'auth.jwtSecret',
    label: 'JWT Secret',
    warning: 'Zmiana natychmiastowo unieważnia wszystkie aktywne sesje JWT. Wymaga restartu.',
    requiresRestart: true,
  },
  {
    key: 'auth.encryptionKey',
    label: 'Encryption Key',
    warning: '⚠ KATASTROFALNA zmiana: wszystkie zaszyfrowane wspomnienia (kategoria credentials) staną się trwale nieczytelne. Zrób backup przed zmianą.',
    requiresRestart: true,
    catastrophic: true,
  },
  {
    key: 'auth.adminApiKey',
    label: 'Admin API Key',
    warning: 'Po zapisaniu panel zostanie wylogowany. Zaloguj się ponownie nowym kluczem.',
    requiresRestart: false,
  },
];

export function DangerZoneTab({ config, setConfig }: Pick<SettingsTabProps, 'config' | 'setConfig'>) {
  const [confirmField, setConfirmField] = useState<DangerField | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [fieldSaving, setFieldSaving] = useState(false);
  const [fieldMsg, setFieldMsg] = useState('');

  const handleSaveField = async (field: DangerField) => {
    if (confirmText !== 'CONFIRM') return;
    setFieldSaving(true); setFieldMsg('');
    try {
      await adminApi.updateConfig({ [field.key]: config[field.key] ?? '' });
      setFieldMsg(`Saved: ${field.label}`);

      // Special handling: admin API key change → re-login
      if (field.key === 'auth.adminApiKey' && config['auth.adminApiKey']) {
        const newKey = config['auth.adminApiKey'];
        localStorage.removeItem(API_KEY_STORAGE);
        setApiKey(newKey);
        setApiBase(localStorage.getItem('memoryai_api_base') ?? '/v1');
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e) {
      setFieldMsg(`Error: ${e instanceof ApiError ? e.message : String(e)}`);
    } finally {
      setFieldSaving(false);
      setConfirmField(null);
      setConfirmText('');
    }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{
        border: '2px solid #fc8181', borderRadius: 10, padding: 16,
        background: 'rgba(252,129,129,0.05)', marginBottom: 24,
      }}>
        <div style={{ fontWeight: 700, color: '#fc8181', marginBottom: 6 }}>⚠ Danger Zone</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          Poniższe ustawienia mogą trwale uszkodzić system lub spowodować utratę danych.
          Każda zmiana wymaga wpisania <code style={{ background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}>CONFIRM</code>.
        </div>
      </div>

      {fieldMsg && (
        <div style={{ fontSize: 13, marginBottom: 16, color: fieldMsg.startsWith('Error') ? '#fc8181' : '#68d391' }}>
          {fieldMsg}
        </div>
      )}

      {FIELDS.map(field => (
        <div key={field.key} style={{
          border: `1px solid ${field.catastrophic ? '#fc8181' : 'var(--border)'}`,
          borderRadius: 8, padding: '14px 16px', marginBottom: 12,
          background: field.catastrophic ? 'rgba(252,129,129,0.05)' : 'var(--bg2)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                {field.label}
                {field.requiresRestart && <span style={{ fontSize: 11, color: 'var(--tier-hot)', marginLeft: 8 }}>restart required</span>}
              </div>
              <div style={{ fontSize: 12, color: field.catastrophic ? '#fc8181' : 'var(--text3)', marginBottom: 10 }}>
                {field.warning}
              </div>
              <input
                type="password"
                value={config[field.key] ?? ''}
                onChange={e => setConfig(c => ({ ...c, [field.key]: e.target.value }))}
                placeholder="(current value hidden)"
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
            <button
              className="btn btn-danger btn-sm"
              style={{ flexShrink: 0, marginTop: 24 }}
              onClick={() => { setConfirmField(field); setConfirmText(''); }}
            >
              Change
            </button>
          </div>
        </div>
      ))}

      {confirmField && (
        <Modal title={`Confirm: Change ${confirmField.label}`} onClose={() => setConfirmField(null)}>
          <div style={{ marginBottom: 16, fontSize: 14, color: confirmField.catastrophic ? '#fc8181' : 'var(--text2)' }}>
            {confirmField.warning}
          </div>
          <div className="form-group">
            <label className="form-label">Type CONFIRM to proceed:</label>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="CONFIRM"
              style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}
              autoFocus
            />
          </div>
          <div className="form-row" style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setConfirmField(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              disabled={confirmText !== 'CONFIRM' || fieldSaving}
              onClick={() => void handleSaveField(confirmField)}
            >
              {fieldSaving ? 'Saving…' : `Yes, change ${confirmField.label}`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
