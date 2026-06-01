// SDK-specific types not present in @memoryai/shared

import type {
  Memory,
  MemorySearchResult,
  MemoryType,
  MemoryTier,
  MemoryCategory,
  Project,
  Session,
  SessionMessage,
  ContextBundle,
  ApiError,
} from '@memoryai/shared';

// Re-export shared types used in SDK public API for convenience
export type {
  Memory,
  MemorySearchResult,
  MemoryType,
  MemoryTier,
  MemoryCategory,
  Project,
  Session,
  SessionMessage,
  ContextBundle,
  ApiError,
};

/** Options passed to `MemoryAIClient` constructor. */
export interface MemoryAIClientOptions {
  /** Your MemoryAI API key (used as Bearer token). */
  apiKey: string;
  /** Base URL of the MemoryAI API. Defaults to `http://localhost:3001`. */
  baseUrl?: string;
}

// ── Memories ────────────────────────────────────────────────

/** Options for `memories.save()`. */
export interface SaveMemoryOptions {
  type?: MemoryType;
  tier?: MemoryTier;
  category?: MemoryCategory;
  /** Importance score between 0 and 1. */
  importance?: number;
  tags?: string[];
  /** Share this memory across all projects. */
  isShared?: boolean;
  /** Scope to a specific project UUID. */
  projectId?: string;
  /** Associate with a specific session UUID. */
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/** Options for `memories.search()`. */
export interface SearchMemoriesOptions {
  /** Maximum results to return (1–20). */
  limit?: number;
  /** Restrict search to this project UUID. */
  projectId?: string;
  /** Filter by memory categories. */
  categories?: MemoryCategory[];
  /** Filter by memory types. */
  types?: MemoryType[];
  /** Filter by tiers. */
  tiers?: MemoryTier[];
  /** Minimum importance score. */
  minImportance?: number;
  /** Include cold-archived memories in results. */
  includeCold?: boolean;
}

/** Options for `memories.list()`. */
export interface ListMemoriesOptions {
  limit?: number;
  offset?: number;
  tier?: MemoryTier;
  category?: MemoryCategory;
  type?: MemoryType;
  projectId?: string;
}

// ── Projects ─────────────────────────────────────────────────

/** Options for `projects.create()`. */
export interface CreateProjectOptions {
  aliases?: string[];
  gitRemote?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/** DTO for `projects.update()`. */
export interface UpdateProjectOptions {
  name?: string;
  aliases?: string[];
  gitRemote?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// ── Sessions ─────────────────────────────────────────────────

/** Options for `sessions.create()`. */
export interface CreateSessionOptions {
  projectId?: string;
  title?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

// ── MCP ──────────────────────────────────────────────────────

/** Options for `mcp.save()` — mirrors MCP memory_save tool args. */
export interface McpSaveOptions {
  type?: MemoryType;
  tier?: MemoryTier;
  category?: MemoryCategory;
  importance?: number;
  tags?: string[];
  isShared?: boolean;
  projectId?: string;
}

/** Raw JSON-RPC 2.0 response returned by the /mcp endpoint. */
export interface McpToolResult {
  jsonrpc: '2.0';
  id: string | number;
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: { code: number; message: string; data?: unknown };
}

/** Paginated list wrapper returned by list endpoints. */
export interface PaginatedResult<T> {
  data: T[];
  meta: { total: number };
}
