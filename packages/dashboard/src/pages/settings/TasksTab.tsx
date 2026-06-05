import type { SettingsTabProps } from './types';
import { FieldRow, SectionTitle, SaveBar } from './FieldRow';

export function TasksTab({ config, setConfig, onSaveConfig, saving, saveMsg }: SettingsTabProps) {
  const f = (key: string) => ({
    value: config[key] ?? '',
    onChange: (v: string) => setConfig(c => ({ ...c, [key]: v })),
  });

  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
        Przypisz dostawców AI do konkretnych zadań. Wybierz "(env default)" żeby używać konfiguracji z pliku .env.
      </p>

      <SectionTitle>Embedding (wyszukiwanie semantyczne)</SectionTitle>
      <FieldRow label="Dostawca" hint="Który provider generuje embeddingi"
        {...f('embedding.provider')}
        options={['ollama', 'gemini', 'openai']} />
      <FieldRow label="Model" placeholder="qwen3-embedding:0.6b" {...f('embedding.ollamaModel')} />
      <FieldRow label="Ollama base URL" placeholder="http://localhost:11434" {...f('embedding.ollamaBaseUrl')} />
      <FieldRow label="Wymiary wektora" placeholder="1024" {...f('embedding.dimensions')} type="number" />
      <FieldRow label="Gemini API key" type="password" {...f('embedding.geminiApiKey')} />
      <FieldRow label="OpenAI API key" type="password" {...f('embedding.openaiApiKey')} />

      <SectionTitle>Dystylacja (ekstrakcja wspomnień z sesji)</SectionTitle>
      <FieldRow label="Dostawca" options={['ollama', 'gemini', 'openai', 'anthropic']} {...f('distillation.provider')} />
      <FieldRow label="Model" placeholder="qwen2.5:7b-instruct-q4_K_M" {...f('distillation.model')} />
      <FieldRow label="Ollama base URL" placeholder="http://localhost:11434" {...f('distillation.ollamaBaseUrl')} />
      <FieldRow label="Gemini API key" type="password" {...f('distillation.geminiApiKey')} />
      <FieldRow label="Anthropic API key" type="password" {...f('distillation.anthropicApiKey')} />
      <FieldRow label="OpenAI API key" type="password" {...f('distillation.openaiApiKey')} />
      <FieldRow label="Timeout bezczynności (min)" hint="Dystylacja uruchamia się po N minutach ciszy" type="number" {...f('distillation.inactivityMinutes')} />
      <FieldRow label="Co N wiadomości" hint="0 = wyłączone. Dystylacja co N wiadomości niezależnie od timeoutu" type="number" {...f('distillation.everyNMessages')} />

      <SectionTitle>Reranker</SectionTitle>
      <FieldRow label="Włączony" options={['true', 'false']} {...f('reranker.enabled')} />
      <FieldRow label="Model" placeholder="qwen3-reranker:0.6b" {...f('reranker.model')} />
      <FieldRow label="Top N kandydatów" hint="Ile wyników z RRF przekazać do rerankera" type="number" {...f('reranker.topN')} />

      <SectionTitle>OpenAI Proxy (backend)</SectionTitle>
      <FieldRow label="Backend URL" placeholder="https://api.openai.com" {...f('proxy.backendUrl')} />
      <FieldRow label="Backend API key" type="password" {...f('proxy.backendApiKey')} />

      <SaveBar onSave={onSaveConfig} saving={saving} msg={saveMsg} requiresRestart />
    </div>
  );
}
