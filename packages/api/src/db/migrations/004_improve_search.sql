-- Improve search recall:
-- 1. Add pg_trgm for trigram/substring similarity matching
-- 2. Rebalance search weights: more FTS (0.15→0.25), slightly less vector (0.55→0.50)
-- 3. Use 'english' tsvector config for better EN→PL cross-lingual text matching
-- 4. Add trigram similarity as additional signal

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Must DROP first — PostgreSQL won't replace a function when OUT param types change
DROP FUNCTION IF EXISTS search_memories_v2(uuid, vector, text, integer, uuid, text[], text[], double precision, boolean);

-- Add GIN trigram index for fast similarity search
CREATE INDEX IF NOT EXISTS memories_content_trgm_idx
  ON memories USING GIN (content gin_trgm_ops);

-- Recreate search_memories_v2 with improved weights and trigram boost
CREATE OR REPLACE FUNCTION search_memories_v2(
  p_user_id        UUID,
  p_embedding      vector,
  p_query          TEXT,
  p_limit          INT     DEFAULT 10,
  p_project_id     UUID    DEFAULT NULL,
  p_types          TEXT[]  DEFAULT NULL,
  p_categories     TEXT[]  DEFAULT NULL,
  p_min_importance FLOAT   DEFAULT 0.0,
  p_include_cold   BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID, content TEXT, type TEXT, tier TEXT, category TEXT,
  importance FLOAT, tags TEXT[], metadata JSONB, created_at TIMESTAMPTZ,
  session_id UUID,
  vector_score FLOAT, text_score FLOAT, recency_score FLOAT, combined_score FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    m.id, m.content, m.type, m.tier, m.category,
    m.importance, m.tags, m.metadata, m.created_at, m.session_id,

    (1 - (m.embedding <=> p_embedding))::FLOAT AS vector_score,

    -- Combined text score: tsvector rank + trigram similarity
    GREATEST(
      ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', p_query)),
      ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', p_query)),
      similarity(lower(m.content), lower(p_query)) * 0.5
    )::FLOAT AS text_score,

    EXP(
      -EXTRACT(epoch FROM (NOW() - m.created_at)) / 15552000.0
    )::FLOAT AS recency_score,

    (
      -- Weights: vector 50%, text 25%, importance 8%, tier 10%, recency 7%
      0.50 * (1 - (m.embedding <=> p_embedding))
      + 0.25 * GREATEST(
          ts_rank(to_tsvector('simple', m.content), plainto_tsquery('simple', p_query)),
          ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', p_query)),
          similarity(lower(m.content), lower(p_query)) * 0.5
        )
      + 0.08 * m.importance
      + 0.10 * CASE m.tier
                 WHEN 'hot'  THEN 0.20
                 WHEN 'warm' THEN 0.00
                 ELSE 0.00
               END
      + 0.07 * EXP(-EXTRACT(epoch FROM (NOW() - m.created_at)) / 15552000.0)
    )::FLOAT AS combined_score

  FROM memories m
  WHERE
    m.user_id = p_user_id
    AND m.embedding IS NOT NULL
    AND m.tier != 'core'
    AND (p_include_cold OR m.tier != 'cold')
    AND m.importance >= p_min_importance
    AND (p_project_id IS NULL OR m.project_id = p_project_id OR m.is_shared = TRUE)
    AND (p_types IS NULL     OR m.type = ANY(p_types))
    AND (p_categories IS NULL OR m.category = ANY(p_categories))
  ORDER BY combined_score DESC
  LIMIT p_limit * 3  -- over-fetch, then re-rank at app level if needed
$$;
