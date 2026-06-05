-- Persistent user settings — overrides env vars at runtime.
-- Per-user key/value store for model config, API keys, etc.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key       TEXT        NOT NULL,
  value     TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS user_settings_user_idx ON user_settings(user_id);
