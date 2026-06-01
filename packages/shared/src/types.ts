// MemoryAI — shared types used across all packages

export type MemoryType = 'fact' | 'decision' | 'preference' | 'instruction' | 'entity_relation' | 'summary';
export type EntityType = 'person' | 'project' | 'company' | 'tool' | 'concept' | 'place' | 'other';
export type SessionStatus = 'active' | 'closed' | 'distilled';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Retrieval priority tier.
 * - core  → always loaded without vector search (user profile, meta instructions)
 * - hot   → boosted in semantic search (recent decisions, active projects)
 * - warm  → standard search (default)
 * - cold  → archival — searchable but excluded from get_context
 */
export type MemoryTier = 'core' | 'hot' | 'warm' | 'cold';

/**
 * Semantic category for filtering and fast retrieval.
 */
export type MemoryCategory =
  | 'user_profile'       // Who the user is, role, background
  | 'meta_instructions'  // Instructions to the AI about behavior
  | 'active_project'     // Currently worked-on project context
  | 'technical_stack'    // Languages, frameworks, tools in use
  | 'preferences'        // Work habits, style, format preferences
  | 'workflow'           // Recurring processes and routines
  | 'domain_knowledge'   // Industry/domain facts and glossary
  | 'decisions'          // Past decisions with rationale
  | 'constraints'        // Deadlines, budgets, limitations
  | 'relationships'      // People, companies, org structure
  | 'temporal'           // Time-sensitive: events, meetings, deadlines
  | 'archive'            // Superseded or historical info
  | 'general';           // Uncategorized (default)

export type LinkType = 'references' | 'supersedes' | 'elaborates' | 'contradicts' | 'relates_to';

export interface User {
  id: string;
  email?: string;
  name?: string;
  api_key: string;
  is_admin: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  project_id?: string;
  title?: string;
  model?: string;
  status: SessionStatus;
  message_count: number;
  metadata: Record<string, unknown>;
  started_at: Date;
  ended_at?: Date;
  distilled_at?: Date;
}

export interface SessionMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface Memory {
  id: string;
  user_id: string;
  project_id?: string;
  session_id?: string;
  tier: MemoryTier;
  category: MemoryCategory;
  type: MemoryType;
  content: string;
  importance: number;
  tags: string[];
  language: string;
  pinned: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_accessed: Date;
  access_count: number;
}

export interface MemorySearchResult extends Memory {
  vector_score: number;
  text_score: number;
  recency_score: number;
  combined_score: number;
}

export interface CoreMemory {
  id: string;
  content: string;
  type: MemoryType;
  category: MemoryCategory;
  importance: number;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface ContextBundle {
  user_id: string;
  core_memories: CoreMemoryJson[];
  key_entities: EntityJson[];
  hot_summary: string;
  built_at: Date;
  is_stale: boolean;
}

export interface CoreMemoryJson {
  id: string;
  content: string;
  type: string;
  category: string;
  importance: number;
  created_at: string;
}

export interface EntityJson {
  name: string;
  type: string;
  facts: Array<{ content: string; source?: string }>;
}

export interface MemoryLink {
  id: string;
  source_id: string;
  target_memory_id?: string;
  target_entity_id?: string;
  link_type: LinkType;
  created_at: Date;
}

export interface MemoryStats {
  tier: MemoryTier;
  category: MemoryCategory;
  count: number;
  avg_importance: number;
}

export interface Entity {
  id: string;
  user_id: string;
  project_id?: string;
  name: string;
  type: EntityType;
  aliases: string[];
  facts: EntityFact[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface EntityFact {
  content: string;
  source?: string;
  created_at?: string;
}

// ── API Request/Response DTOs ──────────────

export interface CreateMemoryDto {
  content: string;
  type?: MemoryType;
  tier?: MemoryTier;
  category?: MemoryCategory;
  importance?: number;
  tags?: string[];
  language?: string;
  pinned?: boolean;
  project_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryDto {
  content?: string;
  type?: MemoryType;
  tier?: MemoryTier;
  category?: MemoryCategory;
  importance?: number;
  tags?: string[];
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SearchMemoriesDto {
  query: string;
  limit?: number;
  project_id?: string;
  types?: MemoryType[];
  categories?: MemoryCategory[];
  tiers?: MemoryTier[];
  min_importance?: number;
  include_cold?: boolean;
}

export interface CreateSessionDto {
  project_id?: string;
  title?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface AddMessageDto {
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface CreateEntityDto {
  name: string;
  type: EntityType;
  aliases?: string[];
  facts?: EntityFact[];
  project_id?: string;
  metadata?: Record<string, unknown>;
}

export interface PaginationQuery {
  limit?: number;
  offset?: number;
}

export interface ApiResponse<T = unknown> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ── MCP Tool types ─────────────────────────

export interface McpMemoryContext {
  memories: Array<{
    content: string;
    type: MemoryType;
    importance: number;
    relevance_score: number;
    created_at: string;
  }>;
  entities: Array<{
    name: string;
    type: EntityType;
    facts: string[];
  }>;
  total_found: number;
  session_id?: string;
}
