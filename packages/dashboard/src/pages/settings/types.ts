export type ConfigState = Record<string, string>;

export interface Provider {
  id: string;
  name: string;
  provider_type: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';
  base_url: string;
  api_key: string | null;
  models: string[];
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface SettingsTabProps {
  config: ConfigState;
  setConfig: (fn: (c: ConfigState) => ConfigState) => void;
  onSaveConfig: () => Promise<void>;
  saving: boolean;
  saveMsg: string;
}

export const FIELD = (
  config: ConfigState,
  setConfig: (fn: (c: ConfigState) => ConfigState) => void,
  key: string,
) => ({
  value: config[key] ?? '',
  onChange: (val: string) => setConfig(c => ({ ...c, [key]: val })),
});
