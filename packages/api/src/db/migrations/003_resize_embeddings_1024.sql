-- Switch embedding dimensions from 768 to 1024 (for mxbai-embed-large multilingual model)
-- Existing embeddings are NULLed — re-embed script must run after migration.
-- Run: node scripts/reembed.mjs

-- Drop vector indexes first (cannot ALTER column type with indexes)
DROP INDEX IF EXISTS memories_embedding_idx;
DROP INDEX IF EXISTS entities_embedding_idx;
DROP INDEX IF EXISTS memories_embedding_cosine_idx;
DROP INDEX IF EXISTS entities_embedding_cosine_idx;

-- Resize memory embeddings (NULL existing — will be re-embedded)
ALTER TABLE memories
  ALTER COLUMN embedding TYPE vector(1024) USING NULL::vector(1024);

-- Resize entity embeddings
ALTER TABLE entities
  ALTER COLUMN embedding TYPE vector(1024) USING NULL::vector(1024);

-- Recreate HNSW indexes for new dimension
CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS entities_embedding_idx
  ON entities USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
