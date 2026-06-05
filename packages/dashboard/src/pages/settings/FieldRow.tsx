import { useState } from 'react';

interface Props {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password' | 'number' | 'url';
  placeholder?: string;
  options?: string[];
  suffix?: string;
}

export function FieldRow({ label, hint, value, onChange, type = 'text', placeholder, options, suffix }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="form-group" style={{ marginBottom: 14 }}>
      <label className="form-label" style={{ fontSize: 12, marginBottom: 4 }}>{label}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {options ? (
          <select value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }}>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            type={type === 'password' ? (show ? 'text' : 'password') : type}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            style={{ flex: 1, fontFamily: type === 'password' ? 'monospace' : undefined }}
          />
        )}
        {type === 'password' && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShow(s => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
        )}
        {suffix && <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{suffix}</span>}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--text3)', borderBottom: '1px solid var(--border)', paddingBottom: 6,
      marginBottom: 14, marginTop: 24,
    }}>
      {children}
    </div>
  );
}

export function SaveBar({ onSave, saving, msg, requiresRestart }: {
  onSave: () => void; saving: boolean; msg: string; requiresRestart?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
      <button className="btn btn-primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {requiresRestart && (
        <span style={{ fontSize: 12, color: 'var(--tier-hot)' }}>
          ⚠ Restart API container to apply
        </span>
      )}
      {msg && (
        <span style={{ fontSize: 13, color: msg.startsWith('Error') ? '#fc8181' : '#68d391' }}>
          {msg}
        </span>
      )}
    </div>
  );
}
