export const API_KEY_STORAGE = 'memoryai_api_key';
export const API_BASE_STORAGE = 'memoryai_api_base';

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function getApiBase(): string {
  return localStorage.getItem(API_BASE_STORAGE) ?? '/v1';
}

export function setApiBase(base: string): void {
  localStorage.setItem(API_BASE_STORAGE, base);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = getApiBase();
  const url = `${base}${path}`;
  const hasBody = body !== undefined;
  const res = await fetch(url, {
    method,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return undefined as T;
  }

  if (!res.ok) {
    const msg =
      (json as { message?: string })?.message ??
      (json as { error?: string })?.error ??
      res.statusText;
    throw new ApiError(res.status, msg, json);
  }

  return json as T;
}

// ── Types ────────────────────────────────────────────────────

export type MemoryTier = 'core' | 'hot' | 'warm' | 'cold';
export type MemoryType =
  | 'fact'
  | 'decision'
  | 'preference'
  | 'instruction'
  | 'entity_relation'
  | 'summary';
export type MemoryCategory =
  | 'user_profile'
  | 'meta_instructions'
  | 'active_project'
  | 'technical_stack'
  | 'preferences'
  | 'workflow'
  | 'domain_knowledge'
  | 'decisions'
  | 'constraints'
  | 'relationships'
  | 'temporal'
  | 'archive'
  | 'infrastructure'
  | 'credentials'
  | 'shared_config'
  | 'general';

export interface Memory {
  id: string;
  user_id: string;
  project_id: string | null;
  session_id: string | null;
  tier: MemoryTier;
  category: MemoryCategory;
  type: MemoryType;
  content: string;
  importance: number;
  tags: string[];
  language: string;
  pinned: boolean;
  is_shared: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_accessed: string | null;
  access_count: number;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  aliases: string[];
  git_remote: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MemoryStat {
  tier: MemoryTier;
  category: MemoryCategory;
  count: number;
  avg_importance: number;
}

export interface AuditEntry {
  id: string;
  user_id: string;
  operation: string;
  category: string | null;
  memory_id: string | null;
  memory_content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ListMemoriesParams {
  limit?: number;
  offset?: number;
  project_id?: string;
  type?: MemoryType;
  tier?: MemoryTier;
  category?: MemoryCategory;
}

export interface CreateMemoryDto {
  content: string;
  type?: MemoryType;
  tier?: MemoryTier;
  category?: MemoryCategory;
  importance?: number;
  tags?: string[];
  is_shared?: boolean;
}

export interface CreateProjectDto {
  name: string;
  git_remote?: string;
  aliases?: string[];
  description?: string;
}

// ── Memory API ───────────────────────────────────────────────

export const memoriesApi = {
  list(params: ListMemoriesParams = {}) {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set('limit', String(params.limit));
    if (params.offset !== undefined) q.set('offset', String(params.offset));
    if (params.project_id) q.set('project_id', params.project_id);
    if (params.type) q.set('type', params.type);
    if (params.tier) q.set('tier', params.tier);
    if (params.category) q.set('category', params.category);
    const qs = q.toString();
    return request<{ data: Memory[]; meta: { total: number } }>(
      'GET',
      `/memories${qs ? `?${qs}` : ''}`,
    );
  },

  get(id: string) {
    return request<{ data: Memory }>('GET', `/memories/${id}`);
  },

  create(dto: CreateMemoryDto) {
    return request<{ data: Memory }>('POST', '/memories', dto);
  },

  update(id: string, dto: Partial<CreateMemoryDto>) {
    return request<{ data: Memory }>('PATCH', `/memories/${id}`, dto);
  },

  delete(id: string) {
    return request<void>('DELETE', `/memories/${id}`);
  },

  search(query: string, options: { limit?: number } = {}) {
    return request<{ data: Memory[]; meta: { total: number } }>('POST', '/memories/search', {
      query,
      limit: options.limit ?? 25,
    });
  },

  stats() {
    return request<{ data: MemoryStat[] }>('GET', '/memories/stats');
  },
};

// ── Projects API ─────────────────────────────────────────────

export const projectsApi = {
  list() {
    return request<{ data: Project[] }>('GET', '/projects');
  },

  create(dto: CreateProjectDto) {
    return request<{ data: Project }>('POST', '/projects', dto);
  },

  addAliases(id: string, aliases: string[]) {
    return request<{ data: Project }>('POST', `/projects/${id}/aliases`, { aliases });
  },

  resolve(name: string) {
    return request<{ data: Project }>('GET', `/projects/resolve?name=${encodeURIComponent(name)}`);
  },

  delete(id: string) {
    return request<void>('DELETE', `/projects/${id}`);
  },
};

// ── Admin API ────────────────────────────────────────────────

export const adminApi = {
  auditLog(params: { operation?: string; limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams();
    if (params.operation) q.set('operation', params.operation);
    if (params.limit !== undefined) q.set('limit', String(params.limit));
    if (params.offset !== undefined) q.set('offset', String(params.offset));
    const qs = q.toString();
    return request<{ data: AuditEntry[]; meta?: { total: number } }>(
      'GET',
      `/admin/audit-log${qs ? `?${qs}` : ''}`,
    );
  },

  createVectorIndex() {
    return request<{ data: unknown }>('POST', '/admin/vector-index');
  },

  runDecay() {
    return request<{ data: { total: number } }>('POST', '/admin/decay');
  },

  runDeduplication() {
    return request<{ data: unknown }>('POST', '/admin/deduplicate');
  },

  stats() {
    return request<{ data: { tier: string; count: string; avg_importance: string }[] }>('GET', '/admin/stats');
  },

  getConfig() {
    return request<{ data: Record<string, string> }>('GET', '/admin/config');
  },

  updateConfig(settings: Record<string, string>) {
    return request<{ data: Record<string, string> }>('PATCH', '/admin/config', settings);
  },

  exportMemories() {
    const base = getApiBase();
    return fetch(`${base}/admin/export`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });
  },

  listProviders() {
    return request<{ data: import('./pages/settings/types').Provider[] }>('GET', '/providers');
  },

  createProvider(dto: Record<string, unknown>) {
    return request<{ data: import('./pages/settings/types').Provider }>('POST', '/providers', dto);
  },

  updateProvider(id: string, dto: Record<string, unknown>) {
    return request<{ data: import('./pages/settings/types').Provider }>('PATCH', `/providers/${id}`, dto);
  },

  deleteProvider(id: string) {
    return request<void>('DELETE', `/providers/${id}`);
  },

  testProvider(id: string) {
    return request<{ data: { ok: boolean; message: string } }>('POST', `/providers/${id}/test`);
  },
};

// ── Auth check ───────────────────────────────────────────────

export async function checkAuth(): Promise<boolean> {
  try {
    await memoriesApi.stats();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return false;
    // Any other error (network, 500) we assume key is set but API might be down
    return getApiKey().length > 0;
  }
}
