/**
 * @memoryai/sdk — TypeScript client for the MemoryAI REST API.
 *
 * @example
 * ```ts
 * import { createClient } from '@memoryai/sdk';
 *
 * const client = createClient({ apiKey: 'mai_...' });
 * await client.memories.save('User prefers TypeScript over JavaScript', { type: 'preference', tier: 'core' });
 * const results = await client.memories.search('TypeScript preferences');
 * ```
 */

import type {
  Memory,
  MemorySearchResult,
  Project,
  Session,
  SessionMessage,
  ContextBundle,
} from '@memoryai/shared';

export type {
  Memory,
  MemorySearchResult,
  Project,
  Session,
  SessionMessage,
  ContextBundle,
} from '@memoryai/shared';

export type {
  MemoryAIClientOptions,
  SaveMemoryOptions,
  SearchMemoriesOptions,
  ListMemoriesOptions,
  CreateProjectOptions,
  UpdateProjectOptions,
  CreateSessionOptions,
  McpSaveOptions,
  McpToolResult,
  PaginatedResult,
} from './types.js';

import type {
  MemoryAIClientOptions,
  SaveMemoryOptions,
  SearchMemoriesOptions,
  ListMemoriesOptions,
  CreateProjectOptions,
  UpdateProjectOptions,
  CreateSessionOptions,
  McpSaveOptions,
  McpToolResult,
  PaginatedResult,
} from './types.js';

// ── Internal helpers ─────────────────────────────────────────

/** Thrown when the API returns a non-2xx status. */
export class MemoryAIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(`MemoryAI API error ${statusCode} (${errorCode}): ${message}`);
    this.name = 'MemoryAIError';
  }
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Strips undefined keys from an object so they are not serialised. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Build a query string from a plain object, skipping undefined values. */
function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  const qs = entries
    .flatMap(([k, v]) =>
      Array.isArray(v)
        ? v.map(item => `${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`)
        : [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`],
    )
    .join('&');
  return `?${qs}`;
}

// ── HTTP transport ────────────────────────────────────────────

class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(options: Required<MemoryAIClientOptions>) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    };
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const qs = query ? buildQuery(query) : '';
    const url = `${this.baseUrl}${path}${qs}`;

    const init: RequestInit = {
      method,
      headers: this.headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      let errorCode = 'UNKNOWN_ERROR';
      let message = res.statusText;
      try {
        const errBody = (await res.json()) as { error?: string; message?: string };
        errorCode = errBody.error ?? errorCode;
        message = errBody.message ?? message;
      } catch {
        // ignore parse errors
      }
      throw new MemoryAIError(res.status, errorCode, message);
    }

    // 204 No Content
    if (res.status === 204) return undefined as unknown as T;

    return res.json() as Promise<T>;
  }

  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T = void>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

// ── MemoriesAPI ───────────────────────────────────────────────

export class MemoriesAPI {
  constructor(private readonly http: HttpClient) {}

  /**
   * Save a new memory.
   *
   * @param content - The text content to persist.
   * @param options - Optional metadata such as type, tier, category, importance, tags.
   * @returns The created `Memory` object.
   *
   * @example
   * ```ts
   * const memory = await client.memories.save('Prefer dark mode', { type: 'preference', tier: 'core' });
   * ```
   */
  async save(content: string, options: SaveMemoryOptions = {}): Promise<Memory> {
    const body = compact({
      content,
      type: options.type,
      tier: options.tier,
      category: options.category,
      importance: options.importance,
      tags: options.tags,
      is_shared: options.isShared,
      project_id: options.projectId,
      session_id: options.sessionId,
      metadata: options.metadata,
    });
    const res = await this.http.post<{ data: Memory }>('/v1/memories', body);
    return res.data;
  }

  /**
   * Semantic search over stored memories.
   *
   * @param query  - Natural language search string.
   * @param options - Optional filters: limit, projectId, categories, types, etc.
   * @returns Array of `MemorySearchResult` sorted by relevance.
   */
  async search(query: string, options: SearchMemoriesOptions = {}): Promise<MemorySearchResult[]> {
    const body = compact({
      query,
      limit: options.limit,
      project_id: options.projectId,
      categories: options.categories,
      types: options.types,
      tiers: options.tiers,
      min_importance: options.minImportance,
      include_cold: options.includeCold,
    });
    const res = await this.http.post<{ data: MemorySearchResult[]; meta: { total: number } }>(
      '/v1/memories/search',
      body,
    );
    return res.data;
  }

  /**
   * Retrieve the pre-built context bundle (fastest; served from cache).
   * Optionally filtered by project name.
   *
   * @param projectName - Optional project name to include project-scoped core memories.
   * @returns A `ContextBundle` with core memories, hot summary and key entities.
   */
  async getContext(projectName?: string): Promise<ContextBundle> {
    const query = projectName ? { project_name: projectName } : undefined;
    const res = await this.http.get<{ data: ContextBundle }>('/v1/memories/context-bundle', query);
    return res.data;
  }

  /**
   * List memories with optional pagination and filters.
   *
   * @param options - Pagination (limit/offset) and filter params.
   * @returns Paginated list of `Memory` objects.
   */
  async list(options: ListMemoriesOptions = {}): Promise<PaginatedResult<Memory>> {
    const query = compact({
      limit: options.limit,
      offset: options.offset,
      tier: options.tier,
      category: options.category,
      type: options.type,
      project_id: options.projectId,
    });
    return this.http.get<PaginatedResult<Memory>>('/v1/memories', query);
  }

  /**
   * Get a single memory by ID.
   *
   * @param id - UUID of the memory.
   * @returns The `Memory` object, or throws `MemoryAIError` with status 404 if not found.
   */
  async get(id: string): Promise<Memory> {
    const res = await this.http.get<{ data: Memory }>(`/v1/memories/${encodeURIComponent(id)}`);
    return res.data;
  }

  /**
   * Delete a memory by ID.
   *
   * @param id - UUID of the memory to delete.
   */
  async delete(id: string): Promise<void> {
    await this.http.delete(`/v1/memories/${encodeURIComponent(id)}`);
  }
}

// ── ProjectsAPI ───────────────────────────────────────────────

export class ProjectsAPI {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a new project.
   *
   * @param name    - Unique project name.
   * @param options - Optional aliases, git remote, description.
   * @returns The created `Project`.
   */
  async create(name: string, options: CreateProjectOptions = {}): Promise<Project> {
    const body = compact({
      name,
      aliases: options.aliases,
      git_remote: options.gitRemote,
      description: options.description,
      metadata: options.metadata,
    });
    const res = await this.http.post<{ data: Project }>('/v1/projects', body);
    return res.data;
  }

  /**
   * List all projects belonging to the authenticated user.
   *
   * @returns Array of `Project` objects.
   */
  async list(): Promise<Project[]> {
    const res = await this.http.get<{ data: Project[] }>('/v1/projects');
    return res.data;
  }

  /**
   * Resolve a project by name or any registered alias.
   *
   * @param nameOrAlias - Project name or any alias string.
   * @returns The matching `Project`, or throws `MemoryAIError` with status 404 if not found.
   */
  async resolve(nameOrAlias: string): Promise<Project> {
    const res = await this.http.get<{ data: Project }>('/v1/projects/resolve', {
      name: nameOrAlias,
    });
    return res.data;
  }

  /**
   * Add additional aliases to an existing project.
   *
   * @param id      - Project UUID.
   * @param aliases - Array of alias strings to add.
   * @returns The updated `Project`.
   */
  async addAliases(id: string, aliases: string[]): Promise<Project> {
    const res = await this.http.post<{ data: Project }>(
      `/v1/projects/${encodeURIComponent(id)}/aliases`,
      { aliases },
    );
    return res.data;
  }

  /**
   * Update project fields.
   *
   * @param id  - Project UUID.
   * @param dto - Fields to update (all optional).
   * @returns The updated `Project`.
   */
  async update(id: string, dto: UpdateProjectOptions): Promise<Project> {
    const body = compact({
      name: dto.name,
      aliases: dto.aliases,
      git_remote: dto.gitRemote,
      description: dto.description,
      metadata: dto.metadata,
    });
    const res = await this.http.patch<{ data: Project }>(
      `/v1/projects/${encodeURIComponent(id)}`,
      body,
    );
    return res.data;
  }
}

// ── SessionsAPI ───────────────────────────────────────────────

export class SessionsAPI {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a new conversation session.
   *
   * @param options - Optional projectId, title, and model name.
   * @returns The created `Session`.
   */
  async create(options: CreateSessionOptions = {}): Promise<Session> {
    const body = compact({
      project_id: options.projectId,
      title: options.title,
      model: options.model,
      metadata: options.metadata,
    });
    const res = await this.http.post<{ data: Session }>('/v1/sessions', body);
    return res.data;
  }

  /**
   * Append a message to an existing session.
   *
   * @param sessionId - UUID of the session.
   * @param role      - Message role: `'user'`, `'assistant'`, `'system'`, or `'tool'`.
   * @param content   - Text content of the message.
   * @returns The created `SessionMessage`.
   */
  async addMessage(sessionId: string, role: string, content: string): Promise<SessionMessage> {
    const res = await this.http.post<{ data: SessionMessage }>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { role, content },
    );
    return res.data;
  }

  /**
   * Close a session. This triggers background memory distillation of the session transcript.
   *
   * @param sessionId - UUID of the session to close.
   * @returns The updated `Session` with status `'closed'`.
   */
  async close(sessionId: string): Promise<Session> {
    const res = await this.http.post<{ data: Session }>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/close`,
    );
    return res.data;
  }
}

// ── McpAPI ────────────────────────────────────────────────────

/** Low-level JSON-RPC helper — builds a compliant MCP request object. */
function mcpRequest(
  method: string,
  params: Record<string, unknown>,
  id: number = 1,
): Record<string, unknown> {
  return { jsonrpc: '2.0', id, method, params };
}

export class McpAPI {
  constructor(private readonly http: HttpClient) {}

  /**
   * Retrieve memory context via the MCP `memory_get_context` tool.
   * Performs 2-phase retrieval: core context + semantic search for the given topics.
   *
   * @param topics      - Array of 3–5 keywords / topics from the current conversation.
   * @param projectName - Optional project name or alias to scope retrieval.
   * @returns The raw text content from the MCP tool response.
   */
  async getContext(topics: string[], projectName?: string): Promise<string> {
    const args: Record<string, unknown> = { topics };
    if (projectName) args['project_name'] = projectName;

    const payload = mcpRequest('tools/call', {
      name: 'memory_get_context',
      arguments: args,
    });

    const res = await this.http.post<McpToolResult>('/mcp', payload);

    if (res.error) {
      throw new MemoryAIError(-32603, 'MCP_TOOL_ERROR', res.error.message);
    }

    return res.result?.content.map(c => c.text).join('\n') ?? '';
  }

  /**
   * Save a memory via the MCP `memory_save` tool.
   *
   * @param content - The text to persist.
   * @param options - Optional type, tier, category, importance, tags, isShared, projectId.
   * @returns The confirmation text from the MCP tool response.
   */
  async save(content: string, options: McpSaveOptions = {}): Promise<string> {
    const args: Record<string, unknown> = compact({
      content,
      type: options.type,
      tier: options.tier,
      category: options.category,
      importance: options.importance,
      tags: options.tags,
      is_shared: options.isShared,
      project_id: options.projectId,
    });

    const payload = mcpRequest('tools/call', {
      name: 'memory_save',
      arguments: args,
    });

    const res = await this.http.post<McpToolResult>('/mcp', payload);

    if (res.error) {
      throw new MemoryAIError(-32603, 'MCP_TOOL_ERROR', res.error.message);
    }

    return res.result?.content.map(c => c.text).join('\n') ?? '';
  }
}

// ── MemoryAIClient ────────────────────────────────────────────

/**
 * Main MemoryAI API client. Groups all API operations into namespaced sub-clients.
 *
 * @example
 * ```ts
 * import { MemoryAIClient } from '@memoryai/sdk';
 *
 * const client = new MemoryAIClient({ apiKey: 'mai_...' });
 *
 * // Save a memory
 * await client.memories.save('User is based in Warsaw', { type: 'fact', tier: 'core' });
 *
 * // Search memories
 * const results = await client.memories.search('Warsaw location');
 *
 * // Create a project
 * const project = await client.projects.create('my-app', { aliases: ['MyApp', 'the app'] });
 * ```
 */
export class MemoryAIClient {
  /** Memories API — save, search, list, get, delete. */
  readonly memories: MemoriesAPI;
  /** Projects API — create, list, resolve, update, addAliases. */
  readonly projects: ProjectsAPI;
  /** Sessions API — create, addMessage, close. */
  readonly sessions: SessionsAPI;
  /** MCP API — higher-level tool wrappers over the JSON-RPC /mcp endpoint. */
  readonly mcp: McpAPI;

  constructor(options: MemoryAIClientOptions) {
    const resolved: Required<MemoryAIClientOptions> = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? 'http://localhost:3001',
    };

    const http = new HttpClient(resolved);

    this.memories = new MemoriesAPI(http);
    this.projects = new ProjectsAPI(http);
    this.sessions = new SessionsAPI(http);
    this.mcp = new McpAPI(http);
  }
}

// ── Factory function ──────────────────────────────────────────

/**
 * Convenience factory — equivalent to `new MemoryAIClient(options)`.
 *
 * @param options - `{ apiKey, baseUrl? }`
 * @returns A configured `MemoryAIClient` instance.
 *
 * @example
 * ```ts
 * import { createClient } from '@memoryai/sdk';
 * const client = createClient({ apiKey: process.env.MEMORYAI_API_KEY! });
 * ```
 */
export function createClient(options: MemoryAIClientOptions): MemoryAIClient {
  return new MemoryAIClient(options);
}

export default createClient;
