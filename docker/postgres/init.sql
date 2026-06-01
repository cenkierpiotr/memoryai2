-- MemoryAI Database Schema
-- PostgreSQL 16 + pgvector

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ──────────────────────────────────────────
-- USERS
-- ──────────────────────────────────────────
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE,
  name        VARCHAR(255),
  api_key     VARCHAR(64) UNIQUE NOT NULL,
  is_admin    BOOLEAN DEFAULT FALSE,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_api_key ON users (api_key);

-- ──────────────────────────────────────────
-- PROJECTS  (optional namespace for memories)
-- ──────────────────────────────────────────
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_projects_user ON projects (user_id);

-- ──────────────────────────────────────────
-- SESSIONS  (conversation tracking)
-- ──────────────────────────────────────────
CREATE TABLE sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id     UUID REFERENCES projects(id) ON DELETE SET NULL,
  title          VARCHAR(255),
  model          VARCHAR(100),
  status         VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','closed','distilled')),
  message_count  INT DEFAULT 0,
  metadata       JSONB DEFAULT '{}',
  started_at     TIMESTAMPTZ DEFAULT NOW(),
  ended_at       TIMESTAMPTZ,
  distilled_at   TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user    ON sessions (user_id, started_at DESC);
CREATE INDEX idx_sessions_project ON sessions (project_id);
CREATE INDEX idx_sessions_status  ON sessions (status);

-- ──────────────────────────────────────────
-- SESSION MESSAGES  (raw conversation buffer)
-- ──────────────────────────────────────────
CREATE TABLE session_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON session_messages (session_id, created_at ASC);

-- ──────────────────────────────────────────
-- MEMORIES  (long-term persistent facts)
-- ──────────────────────────────────────────
CREATE TABLE memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL,
  type            VARCHAR(50) NOT NULL DEFAULT 'fact'
                    CHECK (type IN ('fact','decision','preference','instruction','entity_relation','summary')),
  content         TEXT NOT NULL,
  importance      FLOAT DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  embedding       vector(768),
  tags            TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  last_accessed   TIMESTAMPTZ DEFAULT NOW(),
  access_count    INT DEFAULT 0
);

CREATE INDEX idx_memories_user       ON memories (user_id, created_at DESC);
CREATE INDEX idx_memories_project    ON memories (project_id);
CREATE INDEX idx_memories_type       ON memories (user_id, type);
CREATE INDEX idx_memories_tags       ON memories USING GIN (tags);
CREATE INDEX idx_memories_content_fts ON memories USING GIN (to_tsvector('simple', content));

-- Vector similarity index (IVFFlat — good for up to ~1M rows)
-- Created after first data load for best performance:
-- CREATE INDEX idx_memories_vector ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ──────────────────────────────────────────
-- ENTITIES  (people, projects, companies, tools)
-- ──────────────────────────────────────────
CREATE TABLE entities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  name        VARCHAR(255) NOT NULL,
  type        VARCHAR(50) NOT NULL CHECK (type IN ('person','project','company','tool','concept','place','other')),
  aliases     TEXT[] DEFAULT '{}',
  facts       JSONB DEFAULT '[]',
  embedding   vector(768),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_entities_user    ON entities (user_id);
CREATE INDEX idx_entities_type    ON entities (user_id, type);
CREATE INDEX idx_entities_name    ON entities USING GIN (to_tsvector('simple', name));
CREATE INDEX idx_entities_aliases ON entities USING GIN (aliases);

-- ──────────────────────────────────────────
-- DISTILLATION JOBS  (async background queue log)
-- ──────────────────────────────────────────
CREATE TABLE distillation_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  memories_created INT DEFAULT 0,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- AUTO-UPDATE updated_at TRIGGERS
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated     BEFORE UPDATE ON users     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_projects_updated  BEFORE UPDATE ON projects  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_memories_updated  BEFORE UPDATE ON memories  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_entities_updated  BEFORE UPDATE ON entities  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ──────────────────────────────────────────
-- HELPER FUNCTIONS
-- ──────────────────────────────────────────

-- Hybrid search: vector similarity + full-text
CREATE OR REPLACE FUNCTION search_memories(
  p_user_id     UUID,
  p_embedding   vector(768),
  p_query       TEXT,
  p_limit       INT DEFAULT 10,
  p_project_id  UUID DEFAULT NULL,
  p_types       TEXT[] DEFAULT NULL,
  p_min_importance FLOAT DEFAULT 0.0
)
RETURNS TABLE (
  id UUID, content TEXT, type VARCHAR, importance FLOAT, tags TEXT[],
  metadata JSONB, created_at TIMESTAMPTZ, session_id UUID,
  vector_score FLOAT, text_score FLOAT, combined_score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m.type, m.importance, m.tags,
    m.metadata, m.created_at, m.session_id,
    (1 - (m.embedding <=> p_embedding))::FLOAT AS vector_score,
    ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', p_query))::FLOAT AS text_score,
    (
      0.7 * (1 - (m.embedding <=> p_embedding)) +
      0.2 * ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', p_query)) +
      0.1 * m.importance
    )::FLOAT AS combined_score
  FROM memories m
  WHERE
    m.user_id = p_user_id
    AND m.embedding IS NOT NULL
    AND m.importance >= p_min_importance
    AND (p_project_id IS NULL OR m.project_id = p_project_id)
    AND (p_types IS NULL OR m.type = ANY(p_types))
  ORDER BY combined_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Update access stats when memory is retrieved
CREATE OR REPLACE FUNCTION touch_memories(p_ids UUID[])
RETURNS VOID AS $$
BEGIN
  UPDATE memories
  SET last_accessed = NOW(), access_count = access_count + 1
  WHERE id = ANY(p_ids);
END;
$$ LANGUAGE plpgsql;
