// MemoryAI — shared types used across all packages

export type MemoryType = 'fact' | 'decision' | 'preference' | 'instruction' | 'entity_relation' | 'summary';
export type EntityType = 'person' | 'project' | 'company' | 'tool' | 'concept' | 'place' | 'other';
export type SessionStatus = 'active' | 'closed' | 'distilled';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

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
  type: MemoryType;
  content: string;
  importance: number;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_accessed: Date;
  access_count: number;
}

export interface MemorySearchResult extends Memory {
  vector_score: number;
  text_score: number;
  combined_score: number;
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
  importance?: number;
  tags?: string[];
  project_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryDto {
  content?: string;
  type?: MemoryType;
  importance?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SearchMemoriesDto {
  query: string;
  limit?: number;
  project_id?: string;
  types?: MemoryType[];
  min_importance?: number;
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
