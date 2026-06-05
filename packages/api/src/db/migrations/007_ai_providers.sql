-- AI providers: dynamic list of configured AI API endpoints per user.
-- Allows managing multiple providers (OpenAI, Anthropic, Gemini, Ollama, custom)
-- and assigning them to specific tasks via user_settings.

CREATE TABLE IF NOT EXISTS ai_providers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  provider_type TEXT       NOT NULL CHECK (provider_type IN ('openai','anthropic','gemini','ollama','custom')),
  base_url     TEXT        NOT NULL,
  api_key      TEXT,                     -- stored as-is (user owns their own data)
  models       TEXT[]      DEFAULT '{}',
  is_active    BOOLEAN     DEFAULT TRUE,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS ai_providers_user_idx ON ai_providers(user_id);

-- Add provider assignment keys to user_settings allowlist
-- (handled in application code, not SQL)

-- Seed default Ollama provider for existing users
INSERT INTO ai_providers (user_id, name, provider_type, base_url, models, notes)
SELECT
  id,
  'Ollama (Dell)',
  'ollama',
  COALESCE(
    (SELECT value FROM user_settings WHERE user_id = users.id AND key = 'embedding.ollamaBaseUrl'),
    'http://localhost:11434'
  ),
  ARRAY['qwen3-embedding:0.6b', 'qwen2.5:7b-instruct-q4_K_M', 'qwen3.5:4b'],
  'Lokalny Ollama na serwerze Dell'
FROM users
ON CONFLICT (user_id, name) DO NOTHING;
