import type { SettingsTabProps } from './types';
import { FieldRow, SectionTitle, SaveBar } from './FieldRow';

export function MemoryBehaviorTab({ config, setConfig, onSaveConfig, saving, saveMsg }: SettingsTabProps) {
  const f = (key: string) => ({
    value: config[key] ?? '',
    onChange: (v: string) => setConfig(c => ({ ...c, [key]: v })),
  });

  return (
    <div style={{ maxWidth: 560 }}>
      <SectionTitle>Zanikanie wspomnień (Memory Decay)</SectionTitle>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
        Worker tygodniowy automatycznie przenosi nieużywane wspomnienia do niższych tierów.
        Wspomnienia w tierze <code>cold</code> są wykluczone z domyślnego wyszukiwania.
      </p>
      <FieldRow label="hot → warm po N dniach" hint="Wspomnienia bez dostępu X dni przechodzą do warm" type="number" suffix="dni" {...f('decay.hotDays')} />
      <FieldRow label="warm → cold po N dniach" hint="Wspomnienia bez dostępu X dni + niska importance → cold" type="number" suffix="dni" {...f('decay.coldDays')} />
      <FieldRow label="Próg importance dla cold" hint="0.0–1.0. Wspomnienia powyżej tego progu nigdy nie trafią do cold" type="number" {...f('decay.coldImportance')} />

      <SectionTitle>Wyszukiwanie</SectionTitle>
      <FieldRow label="Maks. wyników na zapytanie" type="number" suffix="wyników" {...f('search.maxResults')} />

      <SaveBar onSave={onSaveConfig} saving={saving} msg={saveMsg} requiresRestart />
    </div>
  );
}
