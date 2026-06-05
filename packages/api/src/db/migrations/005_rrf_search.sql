-- RRF (Reciprocal Rank Fusion) search
-- Replaces weighted-sum scoring with rank-based fusion of vector + FTS results.
-- RRF constant k=60 is industry standard (Robertson & Zaragoza 2009).

DROP FUNCTION IF EXISTS search_memories_v2(uuid,vector,text,integer,uuid,text[],text[],double precision,boolean);

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
  WITH base AS (
    SELECT
      m.id, m.content, m.type, m.tier, m.category,
      m.importance, m.tags, m.metadata, m.created_at, m.session_id,

      (1 - (m.embedding <=> p_embedding))::FLOAT AS vector_score,

      GREATEST(
        ts_rank(to_tsvector('simple', m.content),  plainto_tsquery('simple',  p_query)),
        ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', p_query)),
        similarity(lower(m.content), lower(p_query)) * 0.5
      )::FLOAT AS text_score,

      EXP(-EXTRACT(epoch FROM (NOW() - m.created_at)) / 15552000.0)::FLOAT AS recency_score

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
  ),

  -- Rank by vector similarity
  ranked_vector AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY vector_score DESC) AS rank_v
    FROM base
  ),

  -- Rank by text/keyword score
  ranked_text AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY text_score DESC) AS rank_t
    FROM base
  ),

  -- RRF fusion: 1/(k+rank_vector) + 1/(k+rank_text) + recency boost
  rrf AS (
    SELECT
      b.*,
      (
        1.0 / (60 + rv.rank_v)
        + 1.0 / (60 + rt.rank_t)
        + 0.05 * b.recency_score
        + 0.05 * b.importance
      )::FLOAT AS combined_score
    FROM base b
    JOIN ranked_vector rv ON b.id = rv.id
    JOIN ranked_text    rt ON b.id = rt.id
  )

  SELECT
    id, content, type, tier, category,
    importance, tags, metadata, created_at, session_id,
    vector_score, text_score, recency_score, combined_score
  FROM rrf
  ORDER BY combined_score DESC
  LIMIT p_limit * 3
$$;
