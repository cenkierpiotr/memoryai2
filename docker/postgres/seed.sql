-- MemoryAI — Initial Taxonomy Seed
-- Called by auth.service.ts when creating a new user.
-- Seeds the 'core' tier with meta-instructions and profile scaffolding
-- so the AI knows how to use memory from the very first session.
--
-- Usage: SELECT seed_user_memory(user_id);

CREATE OR REPLACE FUNCTION seed_user_memory(p_user_id UUID)
RETURNS INT AS $$
DECLARE
  v_count INT := 0;
BEGIN
  -- Skip if user already has memories (idempotent)
  IF EXISTS (SELECT 1 FROM memories WHERE user_id = p_user_id LIMIT 1) THEN
    RETURN 0;
  END IF;

  -- ── META INSTRUCTIONS (core) ─────────────────────────────
  -- These tell the AI how to use the memory system automatically

  INSERT INTO memories (user_id, tier, category, type, content, importance, tags)
  VALUES
  (
    p_user_id, 'core', 'meta_instructions', 'instruction',
    'MEMORY SYSTEM ACTIVE: At the start of every conversation, call memory_get_context with the main topics to load relevant memories from previous sessions. This provides continuity without the user repeating themselves.',
    1.0, ARRAY['meta','system','startup']
  ),
  (
    p_user_id, 'core', 'meta_instructions', 'instruction',
    'SAVING MEMORIES: Use memory_save proactively when you learn: facts about the user or their work, decisions that were made, user preferences, project-specific information, or any context useful in future conversations. Write memories as self-contained sentences — understandable without the surrounding conversation.',
    1.0, ARRAY['meta','system','saving']
  ),
  (
    p_user_id, 'core', 'meta_instructions', 'instruction',
    'MEMORY TYPES: Use correct types — fact: general info, decision: choice made with rationale, preference: user likes/dislikes/habits, instruction: rule to always follow, entity_relation: relationship between named things, summary: conversation summary.',
    0.9, ARRAY['meta','system','taxonomy']
  ),
  (
    p_user_id, 'core', 'meta_instructions', 'instruction',
    'IMPORTANCE SCORES: Set importance carefully — 0.9-1.0 for critical rules/decisions, 0.7-0.8 for important project facts, 0.5-0.6 for general context, 0.3-0.4 for minor details. Core-tier memories are always loaded; high importance hot-tier memories surface first in search.',
    0.9, ARRAY['meta','system','importance']
  ),
  (
    p_user_id, 'core', 'meta_instructions', 'instruction',
    'SESSION END: When the user signals they are done (bye, thanks, that is all, closing), call session_end to close the session and trigger background memory distillation. The full conversation will be analyzed and key facts extracted automatically.',
    0.9, ARRAY['meta','system','session']
  ),
  (
    p_user_id, 'core', 'meta_instructions', 'instruction',
    'ENTITIES: Use entity_save for named things (people, projects, companies, tools). Entity facts persist across sessions and are recalled instantly by name. Prefer entity_save over memory_save for well-defined named entities.',
    0.85, ARRAY['meta','system','entities']
  );
  v_count := v_count + 6;

  -- ── USER PROFILE SCAFFOLDING (core) ──────────────────────
  -- Empty placeholders — filled in by the AI as it learns about the user

  INSERT INTO memories (user_id, tier, category, type, content, importance, tags)
  VALUES
  (
    p_user_id, 'core', 'user_profile', 'fact',
    'USER PROFILE: Not yet populated. Ask the user about their name, role, main projects, and preferred working style in the first conversation. Save what you learn here.',
    0.8, ARRAY['profile','setup']
  ),
  (
    p_user_id, 'core', 'preferences', 'preference',
    'LANGUAGE PREFERENCE: Not yet determined. Respond in the same language the user writes in. Save their language preference once established.',
    0.8, ARRAY['profile','language','preference']
  );
  v_count := v_count + 2;

  -- ── ACTIVE PROJECT SCAFFOLD (hot) ───────────────────────
  INSERT INTO memories (user_id, tier, category, type, content, importance, tags)
  VALUES
  (
    p_user_id, 'hot', 'active_project', 'fact',
    'ACTIVE PROJECTS: Not yet populated. When the user mentions a project they are working on, save its name, goal, and status as a memory with category=active_project and tier=hot. Update when project status changes.',
    0.75, ARRAY['projects','setup']
  );
  v_count := v_count + 1;

  -- ── WORKFLOW SCAFFOLD (warm) ─────────────────────────────
  INSERT INTO memories (user_id, tier, category, type, content, importance, tags)
  VALUES
  (
    p_user_id, 'warm', 'workflow', 'fact',
    'WORKFLOW PATTERNS: Not yet populated. When you notice recurring tasks, processes, or rituals the user follows, save them here. These help you suggest consistent approaches.',
    0.6, ARRAY['workflow','setup']
  ),
  (
    p_user_id, 'warm', 'technical_stack', 'fact',
    'TECHNICAL STACK: Not yet populated. When the user mentions technologies they use, save them here with category=technical_stack. Include languages, frameworks, databases, tools, and infrastructure.',
    0.65, ARRAY['tech','stack','setup']
  );
  v_count := v_count + 2;

  -- Initialize empty context bundle
  INSERT INTO context_bundles (user_id, is_stale)
  VALUES (p_user_id, TRUE)
  ON CONFLICT (user_id) DO NOTHING;

  -- Immediately build the initial bundle (with scaffold memories)
  PERFORM build_context_bundle(p_user_id);

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
