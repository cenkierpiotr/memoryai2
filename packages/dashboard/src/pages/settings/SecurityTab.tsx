import type { SettingsTabProps } from './types';
import { FieldRow, SectionTitle, SaveBar } from './FieldRow';

export function SecurityTab({ config, setConfig, onSaveConfig, saving, saveMsg }: SettingsTabProps) {
  const f = (key: string) => ({
    value: config[key] ?? '',
    onChange: (v: string) => setConfig(c => ({ ...c, [key]: v })),
  });

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionTitle>Rate Limiting</SectionTitle>
      <FieldRow label="Maks. requestów / minutę" hint="Per klucz API. Domyślnie 10000" type="number" suffix="RPM" {...f('security.rateLimitRpm')} />

      <SectionTitle>CORS</SectionTitle>
      <FieldRow label="Dozwolone origins" hint="Oddzielone przecinkami. * = wszystkie (niezalecane na produkcji)" placeholder="https://twoja-app.com,http://localhost:3000" {...f('security.corsOrigins')} />

      <SectionTitle>Auth</SectionTitle>
      <FieldRow label="JWT expiry" hint="Format: 24h, 7d, 1h" placeholder="24h" {...f('security.jwtExpiry')} />

      <SaveBar onSave={onSaveConfig} saving={saving} msg={saveMsg} requiresRestart />
    </div>
  );
}
