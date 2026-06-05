import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalNum(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') === 'development',

  server: {
    port: optionalNum('API_PORT', 3001),
    host: optional('API_HOST', '0.0.0.0'),
  },

  db: {
    url: required('DATABASE_URL'),
    poolMin: optionalNum('DB_POOL_MIN', 2),
    poolMax: optionalNum('DB_POOL_MAX', 10),
  },

  redis: {
    url: required('REDIS_URL'),
  },

  auth: {
    jwtSecret: required('JWT_SECRET'),
    adminApiKey: required('ADMIN_API_KEY'),
    jwtExpiry: optional('JWT_EXPIRY', '24h'),
  },

  cors: {
    origins: optional('CORS_ORIGINS', '*').split(',').map(s => s.trim()),
  },

  embedding: {
    provider: optional('EMBEDDING_PROVIDER', 'ollama') as 'ollama' | 'gemini' | 'openai',
    dimensions: optionalNum('EMBED_DIMENSIONS', 768),
    ollamaBaseUrl: optional('OLLAMA_BASE_URL', 'http://localhost:11434'),
    ollamaModel: optional('OLLAMA_EMBED_MODEL', 'nomic-embed-text'),
    geminiApiKey: optional('GEMINI_API_KEY', ''),
    geminiModel: optional('GEMINI_EMBED_MODEL', 'text-embedding-004'),
    openaiApiKey: optional('OPENAI_API_KEY', ''),
    openaiModel: optional('OPENAI_EMBED_MODEL', 'text-embedding-3-small'),
  },

  distillation: {
    provider: optional('DISTILL_PROVIDER', 'ollama') as 'ollama' | 'gemini' | 'openai' | 'anthropic',
    model: optional('DISTILL_MODEL', 'qwen2.5:7b'),
    ollamaBaseUrl: optional('OLLAMA_BASE_URL', 'http://localhost:11434'),
    geminiApiKey: optional('GEMINI_API_KEY', ''),
    openaiApiKey: optional('OPENAI_API_KEY', ''),
    anthropicApiKey: optional('ANTHROPIC_API_KEY', ''),
    inactivityMinutes: optionalNum('DISTILL_INACTIVITY_MINUTES', 15),
    everyNMessages: optionalNum('DISTILL_EVERY_N_MESSAGES', 50),
  },

  reranker: {
    enabled: optional('RERANKER_ENABLED', 'true') === 'true',
    ollamaBaseUrl: optional('OLLAMA_BASE_URL', 'http://localhost:11434'),
    model: optional('RERANKER_MODEL', 'qwen3-reranker:0.6b'),
    topN: optionalNum('RERANKER_TOP_N', 20),
  },

  mcp: {
    serverUrl: optional('MCP_SERVER_URL', 'http://localhost:3001/mcp'),
  },

  security: {
    searchMaxResults: optionalNum('SEARCH_MAX_RESULTS', 20),
    rateLimitRpm: optionalNum('RATE_LIMIT_RPM', 10000),
    encryptionKey: required('ENCRYPTION_KEY'),
  },
} as const;

// Validate provider-specific API keys at startup
export function validateConfig(): void {
  const { embedding, distillation } = config;

  if (embedding.provider === 'gemini' && !embedding.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini');
  }
  if (embedding.provider === 'openai' && !embedding.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
  }
  if (distillation.provider === 'gemini' && !distillation.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required when DISTILL_PROVIDER=gemini');
  }
  if (distillation.provider === 'openai' && !distillation.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required when DISTILL_PROVIDER=openai');
  }
  if (distillation.provider === 'anthropic' && !distillation.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required when DISTILL_PROVIDER=anthropic');
  }
}
