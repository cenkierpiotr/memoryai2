-- Add key_hash column for secure API key storage
-- Uses SHA-256 hashes instead of plaintext to protect keys if DB is compromised

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users ADD COLUMN IF NOT EXISTS key_hash TEXT;

-- Populate key_hash from existing plaintext keys using SHA-256
UPDATE users
SET key_hash = encode(digest(api_key, 'sha256'), 'hex')
WHERE key_hash IS NULL AND api_key IS NOT NULL;

-- Add unique index
CREATE UNIQUE INDEX IF NOT EXISTS users_key_hash_idx ON users (key_hash) WHERE key_hash IS NOT NULL;
