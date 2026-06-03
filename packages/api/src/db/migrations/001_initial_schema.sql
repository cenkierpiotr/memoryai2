-- MemoryAI — Complete Database Schema
-- PostgreSQL 16 + pgvector
-- Optimized for fast LLM context retrieval with 2-phase loading:
--   Phase 1 (instant):  tier='core' — always loaded, no vector needed, Redis-cached
--   Phase 2 (semantic): tier='hot'+'warm' — vector+text+recency search
--   Archived:           tier='cold' — searchable but excluded from default results

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ──────────────────────────────────────────
-- TAXONOMY REFERENCE
-- ──────────────────────────────────────────
-- Memory tiers (retrieval priority):
--   core  → always loaded into every session (user profile, meta instructions, key preferences)
--   hot   → high priority search results (recent decisions, active project, frequent access)
--   warm  → standard semantic search (general facts, older context) [DEFAULT]
--   cold  → archival — searchable but excluded from get_context results
--
-- Memory categories:
--   user_profile      → Who the user is, role, skills, contact
--   meta_instructions → Instructions TO the AI: how to behave, format, language
--   active_project    → Currently worked-on project — goals, status, stack
--   technical_stack   → Technologies, frameworks, databases, patterns in use
--   preferences       → Work habits, style, format preferences
--   workflow          → Recurring processes, routines, rituals
--   domain_knowledge  → Industry/domain facts, glossary, standards
--   decisions         → Past decisions with rationale
--   constraints       → Deadlines, budgets, team size, limitations
--   relationships     → People, companies, org structure
--   temporal          → Time-sensitive context (events, meetings, deadlines)
--   archive           → Superseded or historical info
--   general           → Uncategorized [DEFAULT]

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
-- PROJECTS
-- ──────────────────────────────────────────
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  aliases     TEXT[] NOT NULL DEFAULT '{}',  -- alternative names: repo name, workspace, abbreviation
  git_remote  TEXT,                          -- e.g. github.com/user/repo for auto-detection
  description TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_projects_user    ON projects (user_id);
CREATE INDEX idx_projects_aliases ON projects USING GIN (aliases);
CREATE INDEX idx_projects_remote  ON projects (user_id, git_remote) WHERE git_remote IS NOT NULL;

-- ──────────────────────────────────────────
-- SESSIONS
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
-- SESSION MESSAGES
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
-- MEMORIES
-- Core table — optimized for 2-phase retrieval
-- ──────────────────────────────────────────
CREATE TABLE memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL,

  -- Retrieval taxonomy
  tier            VARCHAR(10) DEFAULT 'warm'
                    CHECK (tier IN ('core','hot','warm','cold')),
  category        VARCHAR(50) DEFAULT 'general'
                    CHECK (category IN (
                      'user_profile','meta_instructions','active_project',
                      'technical_stack','preferences','workflow',
                      'domain_knowledge','decisions','constraints',
                      'relationships','temporal','archive',
                      'infrastructure','credentials','shared_config',
                      'general'
                    )),
  -- Shared memories are visible across all projects when relevant topic appears
  -- Auto-set TRUE for categories: credentials, infrastructure, shared_config
  is_shared       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Memory content
  type            VARCHAR(50) NOT NULL DEFAULT 'fact'
                    CHECK (type IN ('fact','decision','preference','instruction','entity_relation','summary')),
  content         TEXT NOT NULL,
  importance      FLOAT DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),

  -- Semantic search
  embedding       vector(768),  -- dimension must match EMBED_DIMENSIONS in .env

  -- Metadata
  tags            TEXT[] DEFAULT '{}',
  language        VARCHAR(10) DEFAULT 'auto',  -- 'pl', 'en', 'auto'
  metadata        JSONB DEFAULT '{}',

  -- Access tracking (used for auto-promotion to 'hot' tier)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  last_accessed   TIMESTAMPTZ DEFAULT NOW(),
  access_count    INT DEFAULT 0,
  pinned          BOOLEAN DEFAULT FALSE,  -- pinned memories are never demoted

  -- Temporal consolidation (human memory analogy)
  -- Temporal memories are evaluated after consolidation_days and either
  -- converted to long-term memories or archived (forgotten)
  consolidation_at     TIMESTAMPTZ,       -- when to evaluate (auto-set for temporal category)
  consolidation_status VARCHAR(20) DEFAULT 'pending'
                         CHECK (consolidation_status IN ('pending','consolidated','archived'))
);

-- ── Memory indexes ──────────────────────────────────────────

-- Primary lookup
CREATE INDEX idx_memories_user       ON memories (user_id, created_at DESC);
CREATE INDEX idx_memories_project    ON memories (project_id);

-- Tier-based retrieval (partial indexes — very fast)
CREATE INDEX idx_memories_core ON memories (user_id, importance DESC, last_accessed DESC)
  WHERE tier = 'core';

CREATE INDEX idx_memories_hot ON memories (user_id, importance DESC, created_at DESC)
  WHERE tier = 'hot';

-- Category-filtered queries
CREATE INDEX idx_memories_category ON memories (user_id, category, importance DESC);

-- Tier + category combined
CREATE INDEX idx_memories_tier_cat ON memories (user_id, tier, category);

-- Full-text search
CREATE INDEX idx_memories_content_fts ON memories USING GIN (to_tsvector('simple', content));

-- Tag search
CREATE INDEX idx_memories_tags ON memories USING GIN (tags);

-- Recency queries (for stale session checks)
CREATE INDEX idx_memories_recent ON memories (user_id, created_at DESC)
  WHERE tier IN ('hot', 'warm');

-- Access count (for auto-promotion queries)
CREATE INDEX idx_memories_access ON memories (user_id, access_count DESC)
  WHERE tier = 'warm';

-- Shared memories — cross-project access
CREATE INDEX idx_memories_shared ON memories (user_id, category, importance DESC)
  WHERE is_shared = TRUE;

-- Temporal consolidation job candidates
CREATE INDEX idx_memories_consolidation ON memories (consolidation_at)
  WHERE category = 'temporal' AND consolidation_status = 'pending';

-- Note: IVFFlat vector index — create AFTER loading initial data for best performance
-- CREATE INDEX idx_memories_vector ON memories
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ──────────────────────────────────────────
-- ENTITIES
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
  pinned      BOOLEAN DEFAULT FALSE,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_entities_user    ON entities (user_id);
CREATE INDEX idx_entities_type    ON entities (user_id, type);
CREATE INDEX idx_entities_pinned  ON entities (user_id) WHERE pinned = TRUE;
CREATE INDEX idx_entities_name    ON entities USING GIN (to_tsvector('simple', name));
CREATE INDEX idx_entities_aliases ON entities USING GIN (aliases);

-- ──────────────────────────────────────────
-- MEMORY LINKS  (relationship graph)
-- Directed edges between memories and/or entities
-- ──────────────────────────────────────────
CREATE TABLE memory_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_memory_id  UUID REFERENCES memories(id) ON DELETE CASCADE,
  target_entity_id  UUID REFERENCES entities(id) ON DELETE CASCADE,
  link_type         VARCHAR(30) NOT NULL
                      CHECK (link_type IN ('references','supersedes','elaborates','contradicts','relates_to')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  -- Exactly one target must be set
  CONSTRAINT chk_link_target CHECK (
    (target_memory_id IS NOT NULL)::int + (target_entity_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX idx_memory_links_source ON memory_links (source_id);
CREATE INDEX idx_memory_links_target_memory ON memory_links (target_memory_id);
CREATE INDEX idx_memory_links_target_entity ON memory_links (target_entity_id);

-- ──────────────────────────────────────────
-- CONTEXT BUNDLES  (pre-computed fast-load snapshots)
-- One per user — rebuilt on core/hot memory changes
-- Cached in Redis by context-bundle.service.ts
-- ──────────────────────────────────────────
CREATE TABLE context_bundles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  core_memories  JSONB DEFAULT '[]',  -- pre-serialized core tier memories
  key_entities   JSONB DEFAULT '[]',  -- pinned + most recently updated entities
  hot_summary    TEXT DEFAULT '',     -- brief text summary of hot tier themes
  built_at       TIMESTAMPTZ DEFAULT NOW(),
  is_stale       BOOLEAN DEFAULT TRUE  -- true until first build
);

-- ──────────────────────────────────────────
-- AUDIT LOG
-- Tracks access to sensitive memories (credentials category)
-- ──────────────────────────────────────────
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_id   UUID REFERENCES memories(id) ON DELETE SET NULL,
  operation   VARCHAR(20) NOT NULL CHECK (operation IN ('read','write','delete','decrypt')),
  category    VARCHAR(50),
  content_preview TEXT,  -- first 60 chars of decrypted content
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log (user_id, created_at DESC);
CREATE INDEX idx_audit_memory ON audit_log (memory_id) WHERE memory_id IS NOT NULL;
CREATE INDEX idx_audit_operation ON audit_log (operation, created_at DESC);

-- ──────────────────────────────────────────
-- DISTILLATION JOBS
-- ──────────────────────────────────────────
CREATE TABLE distillation_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           VARCHAR(20) DEFAULT 'pending'
                     CHECK (status IN ('pending','running','done','failed')),
  memories_created INT DEFAULT 0,
  error            TEXT,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id)
);

-- ──────────────────────────────────────────
-- TRIGGERS: updated_at
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
-- TRIGGER: Auto-set consolidation_at for temporal memories
-- Temporal memories are scheduled for consolidation 7 days after creation
-- (configurable via metadata->>'consolidation_days')
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_temporal_consolidation()
RETURNS TRIGGER AS $$
DECLARE
  days INT;
BEGIN
  IF NEW.category = 'temporal' AND NEW.consolidation_at IS NULL THEN
    days := COALESCE(
      (NEW.metadata->>'consolidation_days')::INT,
      7
    );
    NEW.consolidation_at := NEW.created_at + (days || ' days')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memories_temporal_consolidation
  BEFORE INSERT ON memories
  FOR EACH ROW
  EXECUTE FUNCTION set_temporal_consolidation();

-- ──────────────────────────────────────────
-- TRIGGER: Auto-promote warm → hot
-- When a warm memory is accessed 5+ times, it gets promoted to hot
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_promote_memory_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.access_count >= 5 AND NEW.tier = 'warm' AND NOT NEW.pinned THEN
    NEW.tier := 'hot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memories_auto_promote
  BEFORE UPDATE OF access_count ON memories
  FOR EACH ROW
  EXECUTE FUNCTION auto_promote_memory_tier();

-- ──────────────────────────────────────────
-- TRIGGER: Invalidate context bundle when core/hot memories change
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION invalidate_context_bundle()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.tier IN ('core', 'hot') THEN
      INSERT INTO context_bundles (user_id, is_stale)
      VALUES (NEW.user_id, TRUE)
      ON CONFLICT (user_id) DO UPDATE SET is_stale = TRUE;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.tier IN ('core', 'hot') THEN
      UPDATE context_bundles SET is_stale = TRUE WHERE user_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memories_invalidate_bundle
  AFTER INSERT OR UPDATE OR DELETE ON memories
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_context_bundle();

-- ──────────────────────────────────────────
-- FUNCTION: resolve_project
-- Resolve project name OR any alias to UUID (case-insensitive).
-- Also matches partial git_remote URL (e.g. "memoryai" matches github.com/user/memoryai).
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION resolve_project(p_user_id UUID, p_name TEXT)
RETURNS UUID AS $$
  SELECT id FROM projects
  WHERE user_id = p_user_id
    AND (
      lower(name) = lower(p_name)
      OR lower(p_name) = ANY(SELECT lower(a) FROM unnest(aliases) a)
      OR (git_remote IS NOT NULL AND lower(git_remote) LIKE '%' || lower(p_name) || '%')
    )
  ORDER BY
    CASE
      WHEN lower(name) = lower(p_name) THEN 0
      WHEN lower(p_name) = ANY(SELECT lower(a) FROM unnest(aliases) a) THEN 1
      ELSE 2
    END
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ──────────────────────────────────────────
-- FUNCTION: get_core_context
-- Phase 1 retrieval — no vector needed, sub-millisecond via partial index
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_core_context(
  p_user_id    UUID,
  p_project_id UUID DEFAULT NULL,
  p_limit      INT DEFAULT 15
)
RETURNS TABLE (
  id UUID, content TEXT, type VARCHAR, category VARCHAR,
  importance FLOAT, tags TEXT[], metadata JSONB, created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m.type, m.category,
    m.importance, m.tags, m.metadata, m.created_at
  FROM memories m
  WHERE
    m.user_id = p_user_id
    AND m.tier = 'core'
    AND (
      p_project_id IS NULL
      OR m.project_id = p_project_id
      OR m.project_id IS NULL   -- global core memories
      OR m.is_shared = TRUE     -- shared across all projects
    )
  ORDER BY
    -- project-specific first, then shared, then global
    CASE WHEN m.project_id = p_project_id THEN 0
         WHEN m.is_shared THEN 1
         ELSE 2 END,
    m.importance DESC,
    m.last_accessed DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────
-- FUNCTION: search_memories_v2
-- Phase 2 retrieval — tier-aware hybrid search with recency weighting
-- Excludes core tier (loaded in phase 1) and cold tier (archival)
--
-- Score formula (weights sum to 1.0):
--   0.55 × vector_similarity    — semantic match
--   0.15 × text_rank            — keyword match
--   0.10 × importance           — user-set priority
--   0.12 × tier_boost           — hot=+0.20, warm=0, (core/cold excluded)
--   0.08 × recency_score        — 1.0 today → ~0.37 at 6mo → ~0.14 at 1yr
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_memories_v2(
  p_user_id        UUID,
  p_embedding      vector(768),
  p_query          TEXT,
  p_limit          INT DEFAULT 10,
  p_project_id     UUID DEFAULT NULL,
  p_types          TEXT[] DEFAULT NULL,
  p_categories     TEXT[] DEFAULT NULL,
  p_min_importance FLOAT DEFAULT 0.0,
  p_include_cold   BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID, content TEXT, type VARCHAR, tier VARCHAR, category VARCHAR,
  importance FLOAT, tags TEXT[], metadata JSONB,
  created_at TIMESTAMPTZ, session_id UUID,
  vector_score FLOAT, text_score FLOAT, recency_score FLOAT, combined_score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m.type, m.tier, m.category,
    m.importance, m.tags, m.metadata, m.created_at, m.session_id,

    (1 - (m.embedding <=> p_embedding))::FLOAT AS vector_score,

    ts_rank(
      to_tsvector('simple', m.content),
      plainto_tsquery('simple', p_query)
    )::FLOAT AS text_score,

    EXP(
      -EXTRACT(epoch FROM (NOW() - m.created_at)) / 15552000.0
    )::FLOAT AS recency_score,

    (
      0.55 * (1 - (m.embedding <=> p_embedding))
      + 0.15 * ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', p_query))
      + 0.10 * m.importance
      + 0.12 * CASE m.tier
                 WHEN 'hot'  THEN 0.20
                 WHEN 'warm' THEN 0.00
                 ELSE 0.00
               END
      + 0.08 * EXP(-EXTRACT(epoch FROM (NOW() - m.created_at)) / 15552000.0)
    )::FLOAT AS combined_score

  FROM memories m
  WHERE
    m.user_id = p_user_id
    AND m.embedding IS NOT NULL
    AND m.tier != 'core'   -- core loaded separately in phase 1
    AND (p_include_cold OR m.tier != 'cold')
    AND m.importance >= p_min_importance
    AND (
      p_project_id IS NULL          -- no project filter: all memories
      OR m.project_id = p_project_id -- memory belongs to this project
      OR m.project_id IS NULL        -- global memories
      OR m.is_shared = TRUE          -- shared across all projects
    )
    AND (p_types IS NULL OR m.type = ANY(p_types))
    AND (p_categories IS NULL OR m.category = ANY(p_categories))
  ORDER BY combined_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────
-- FUNCTION: find_duplicate_memories
-- Returns pairs of memories with cosine similarity above threshold.
-- Used by the deduplication worker to merge near-identical memories.
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION find_duplicate_memories(
  p_user_id   UUID,
  p_threshold FLOAT DEFAULT 0.95,
  p_limit     INT DEFAULT 50
)
RETURNS TABLE (
  id_a        UUID,
  id_b        UUID,
  content_a   TEXT,
  content_b   TEXT,
  similarity  FLOAT,
  category_a  VARCHAR,
  category_b  VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    b.id,
    a.content,
    b.content,
    (1 - (a.embedding <=> b.embedding))::FLOAT AS similarity,
    a.category,
    b.category
  FROM memories a
  JOIN memories b ON b.user_id = a.user_id AND b.id > a.id
  WHERE
    a.user_id = p_user_id
    AND a.embedding IS NOT NULL
    AND b.embedding IS NOT NULL
    AND a.tier != 'cold' AND b.tier != 'cold'
    AND (1 - (a.embedding <=> b.embedding)) >= p_threshold
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Keep v1 for backward compatibility
CREATE OR REPLACE FUNCTION search_memories(
  p_user_id        UUID,
  p_embedding      vector(768),
  p_query          TEXT,
  p_limit          INT DEFAULT 10,
  p_project_id     UUID DEFAULT NULL,
  p_types          TEXT[] DEFAULT NULL,
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
    r.id, r.content, r.type, r.importance, r.tags,
    r.metadata, r.created_at, r.session_id,
    r.vector_score, r.text_score, r.combined_score
  FROM search_memories_v2(
    p_user_id, p_embedding, p_query, p_limit,
    p_project_id, p_types, NULL, p_min_importance, FALSE
  ) r;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────
-- FUNCTION: build_context_bundle
-- Called by context-bundle.service.ts when bundle is stale
-- Serializes core memories + pinned entities into JSONB
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION build_context_bundle(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_core_memories JSONB;
  v_key_entities  JSONB;
BEGIN
  -- Serialize core memories: global (no project) + shared across all projects
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',          m.id,
      'content',     m.content,
      'type',        m.type,
      'category',    m.category,
      'importance',  m.importance,
      'is_shared',   m.is_shared,
      'created_at',  m.created_at
    ) ORDER BY m.importance DESC, m.last_accessed DESC
  ), '[]'::jsonb)
  INTO v_core_memories
  FROM memories m
  WHERE m.user_id = p_user_id
    AND m.tier = 'core'
    AND (m.project_id IS NULL OR m.is_shared = TRUE)
  LIMIT 20;

  -- Serialize pinned + recently updated entities
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name',  e.name,
      'type',  e.type,
      'facts', e.facts
    ) ORDER BY e.pinned DESC, e.updated_at DESC
  ), '[]'::jsonb)
  INTO v_key_entities
  FROM entities e
  WHERE e.user_id = p_user_id
  LIMIT 10;

  INSERT INTO context_bundles (user_id, core_memories, key_entities, built_at, is_stale)
  VALUES (p_user_id, v_core_memories, v_key_entities, NOW(), FALSE)
  ON CONFLICT (user_id) DO UPDATE SET
    core_memories = EXCLUDED.core_memories,
    key_entities  = EXCLUDED.key_entities,
    built_at      = NOW(),
    is_stale      = FALSE;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────
-- FUNCTION: touch_memories
-- Update access stats after retrieval (called async)
-- Also triggers auto-promotion check via trg_memories_auto_promote
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_memories(p_ids UUID[])
RETURNS VOID AS $$
BEGIN
  UPDATE memories
  SET
    last_accessed = NOW(),
    access_count  = access_count + 1
  WHERE id = ANY(p_ids);
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────
-- FUNCTION: get_memory_stats
-- Returns per-tier and per-category counts for dashboard
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_memory_stats(p_user_id UUID)
RETURNS TABLE (
  tier      VARCHAR,
  category  VARCHAR,
  count     BIGINT,
  avg_importance FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.tier,
    m.category,
    COUNT(*)::BIGINT,
    ROUND(AVG(m.importance)::NUMERIC, 2)::FLOAT
  FROM memories m
  WHERE m.user_id = p_user_id
  GROUP BY m.tier, m.category
  ORDER BY m.tier, m.category;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  filename    TEXT UNIQUE NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO schema_migrations (filename)
VALUES ('001_initial_schema.sql')
ON CONFLICT DO NOTHING;
