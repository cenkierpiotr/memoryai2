/**
 * MemoryAI MCP Server
 *
 * Implements the Model Context Protocol (MCP) over HTTP/SSE.
 * Compatible with Antigravity (serverUrl mode) and Claude Code.
 *
 * Tools are described to instruct models to use memory automatically,
 * without requiring explicit user prompting.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/pool.js';
import { memoryService } from '../services/memory.service.js';
import { entityService } from '../services/entity.service.js';
import { sessionService } from '../services/session.service.js';
import { authService } from '../services/auth.service.js';
import { contextBundleService } from '../services/context-bundle.service.js';
import { projectService } from '../services/project.service.js';
import type { MemoryType, MemoryCategory } from '@memoryai/shared';

// ── MCP Protocol Types ──────────────────────────────────────

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── Tool Definitions ────────────────────────────────────────

const TOOLS: McpTool[] = [
  {
    name: 'memory_get_context',
    description: `Call this tool ONCE at the very beginning of each new conversation, before your first response.
Do NOT call it again within the same conversation — use memory_search for specific follow-up lookups instead.
Uses 2-phase retrieval: Phase 1 loads core context instantly (user profile, instructions, key preferences).
Phase 2 does semantic search for topic-specific memories relevant to the current conversation topics.
Pass force_reload=true only if the user explicitly asks to refresh their memory context.`,
    inputSchema: {
      type: 'object',
      properties: {
        topics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key topics or keywords from the current conversation. Extract 3-5 main themes for semantic search.',
        },
        project_name: {
          type: 'string',
          description: 'Project name or ANY alias — e.g. "memoryai", "memory-ai", "the pgvector project", "cenkierpiotr/memoryai". System auto-resolves to the correct project. Prefer this over project_id.',
        },
        project_id: {
          type: 'string',
          description: 'Optional project UUID (use project_name instead when possible).',
        },
        limit: {
          type: 'number',
          description: 'Maximum topic-specific memories to retrieve (default: 7, max: 20).',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Narrow Phase 2 to specific categories to reduce token usage. Coding: ["technical_stack","active_project","decisions","infrastructure"]. General: ["user_profile","preferences","workflow"]. Credentials/config: ["credentials","infrastructure","shared_config"].',
        },
        force_reload: {
          type: 'boolean',
          description: 'Set true to reload context even if already loaded recently in this session.',
        },
      },
      required: ['topics'],
    },
  },
  {
    name: 'memory_save',
    description: `Save important information to persistent memory so it will be available in future conversations.
Call this whenever you learn: facts about the user or their work, decisions made, user preferences, project-specific info, or standing instructions.
Choose the correct tier and category to ensure fast retrieval: use tier=core for user profile facts and standing instructions, tier=hot for active project details and recent decisions, tier=warm for general facts (default).`,
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The information to remember. Write as a complete, self-contained sentence — understandable without the surrounding conversation.',
        },
        type: {
          type: 'string',
          enum: ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'],
          description: 'fact=general info, decision=choice made with rationale, preference=user likes/dislikes, instruction=rule to always follow, entity_relation=relationship between things, summary=session overview.',
        },
        tier: {
          type: 'string',
          enum: ['core', 'hot', 'warm', 'cold'],
          description: 'Retrieval priority. core=always loaded (user profile, standing instructions), hot=boosted in search (active project, recent decisions), warm=standard search (default), cold=archival.',
        },
        category: {
          type: 'string',
          enum: ['user_profile','meta_instructions','active_project','technical_stack','preferences','workflow','domain_knowledge','decisions','constraints','relationships','temporal','archive','infrastructure','credentials','shared_config','general'],
          description: 'Semantic category. infrastructure=servers/IPs/network config, credentials=API keys/tokens (auto-encrypted+shared), shared_config=config reused across projects. These 3 are auto-shared across all projects.',
        },
        is_shared: {
          type: 'boolean',
          description: 'Make this memory visible across ALL projects. Auto-set true for categories: credentials, infrastructure, shared_config. Use for any info needed in multiple projects.',
        },
        importance: {
          type: 'number',
          description: 'Priority 0.0-1.0. 0.9-1.0=critical rules/decisions, 0.7-0.8=important facts, 0.5-0.6=general context, 0.3-0.4=minor details.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords for filtering (e.g., ["project:memoryai", "tech:typescript"]).',
        },
        project_id: {
          type: 'string',
          description: 'Optional project UUID to scope this memory to a specific project.',
        },
      },
      required: ['content', 'type'],
    },
  },
  {
    name: 'memory_search',
    description: `Search for specific memories using semantic search. Use when you need to find information about a particular topic,
person, project, or decision that may have been discussed in a previous session.
More targeted than memory_get_context — use when looking for something specific.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query describing what you are looking for.',
        },
        types: {
          type: 'array',
          items: { type: 'string', enum: ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'] },
          description: 'Optional: filter by memory type.',
        },
        limit: {
          type: 'number',
          description: 'Number of results (default: 10, max: 20).',
        },
        project_id: {
          type: 'string',
          description: 'Optional project UUID to narrow search scope.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'entity_save',
    description: `Save or update information about a specific entity (person, project, company, tool, concept).
Use when you learn something significant about a named entity that should be remembered across sessions.
Entities are searchable by name and their facts are retrievable in future conversations.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The entity name (e.g., "Piotr", "MemoryAI project", "Dell server", "PostgreSQL").',
        },
        type: {
          type: 'string',
          enum: ['person', 'project', 'company', 'tool', 'concept', 'place', 'other'],
          description: 'Type of entity.',
        },
        facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'A fact about this entity.' },
              source: { type: 'string', description: 'Optional: where this fact came from.' },
            },
            required: ['content'],
          },
          description: 'Facts to save or add about this entity.',
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alternative names or nicknames for this entity.',
        },
      },
      required: ['name', 'type', 'facts'],
    },
  },
  {
    name: 'entity_get',
    description: `Retrieve stored information about a specific entity by name.
Use when you need to recall what is known about a person, project, company, or tool.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The entity name to look up.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'session_end',
    description: `Call this at the end of a conversation to trigger automatic memory distillation.
The system will analyze the conversation and extract important facts, decisions, and preferences to save for future sessions.
Call this when the user indicates they are done (e.g., "bye", "thanks", "that's all", "see you"), or after a major work session concludes.`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'The current session ID (provided in memory context or by the system).',
        },
        summary: {
          type: 'string',
          description: 'Optional: brief summary of what was accomplished in this session.',
        },
      },
      required: ['session_id'],
    },
  },
];

// ── Tool Handlers ───────────────────────────────────────────

async function handleTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string
): Promise<unknown> {
  switch (toolName) {
    case 'memory_get_context': {
      const forceReload = args.force_reload === true;

      // ── Lazy loading: skip full retrieval if already loaded recently ──
      if (!forceReload) {
        const loadedMinutesAgo = await contextBundleService.isContextLoadedRecently(userId);
        if (loadedMinutesAgo !== null) {
          return {
            content: [{
              type: 'text',
              text: `Memory context loaded ${loadedMinutesAgo}min ago — already in context. Use memory_search for specific topic lookups.`,
            }],
          };
        }
      }

      const rawTopics = args.topics;
      const topics = Array.isArray(rawTopics) ? rawTopics.join(' ') : (rawTopics as string) ?? '';
      const limit = Math.min((args.limit as number | undefined) ?? 7, 20);

      // Resolve project_name (any alias) to UUID
      let projectId = args.project_id as string | undefined;
      const projectName = args.project_name as string | undefined;
      if (projectName && !projectId) {
        const resolved = await projectService.resolveByName(userId, projectName);
        if (resolved) projectId = resolved;
      }

      const validCategories: MemoryCategory[] = [
        'user_profile','meta_instructions','active_project','technical_stack',
        'preferences','workflow','domain_knowledge','decisions','constraints',
        'relationships','temporal','archive','infrastructure','credentials','shared_config','general',
      ];
      const rawCats = Array.isArray(args.categories) ? args.categories as string[] : undefined;
      const categories = rawCats?.filter(c => validCategories.includes(c as MemoryCategory)) as MemoryCategory[] | undefined;

      // ── Phase 1a: global + shared core context (Redis-cached) ────
      // ── Phase 1b: project-specific core (if project known) ───────
      // ── Phase 2:  semantic search hot+warm (parallel) ─────────────
      const [bundle, projectCore, topicMemories, topicEntities] = await Promise.all([
        contextBundleService.get(userId),
        projectId ? memoryService.getCoreContext(userId, projectId, 10) : Promise.resolve([]),
        memoryService.search(userId, {
          query: topics,
          limit,
          project_id: projectId,
          categories,
        }),
        entityService.search(userId, topics, 4),
      ]);

      const globalCoreText = contextBundleService.formatForModel(bundle, projectId);
      const hasGlobalCore = globalCoreText.trim().length > 0;
      const hasProjectCore = projectCore.length > 0;
      const hasTopicMemories = topicMemories.length > 0 || topicEntities.length > 0;

      // Touch Phase 1 memories (core bundle + project core) — they never go through
      // search(), so without this their access_count stays 0 and tier decay misfires.
      const phase1Ids = [
        ...bundle.core_memories.map(m => m.id),
        ...projectCore.map(m => m.id),
      ].filter(Boolean);
      if (phase1Ids.length > 0) {
        query('SELECT touch_memories($1)', [phase1Ids]).catch(() => {});
      }

      if (!hasGlobalCore && !hasProjectCore && !hasTopicMemories) {
        return {
          content: [{ type: 'text', text: 'No memories yet. Start building context by saving important facts with memory_save.' }],
        };
      }

      const lines: string[] = ['[MEMORY]'];

      if (hasGlobalCore) {
        lines.push(globalCoreText);
      }

      if (hasProjectCore) {
        if (hasGlobalCore) lines.push('');
        lines.push(`[PROJECT: ${projectName ?? projectId}]`);
        for (const m of projectCore) {
          const cat = m.category !== 'general' ? `[${m.category}] ` : '';
          const content = m.content.length > 200 ? m.content.slice(0, 199) + '…' : m.content;
          lines.push(`${cat}${content}`);
        }
      }

      if (topicMemories.length > 0) {
        lines.push('');
        lines.push('[TOPIC]');
        for (const m of topicMemories) {
          const date = new Date(m.created_at).toLocaleDateString('pl-PL');
          const hot = m.tier === 'hot' ? '★ ' : '';
          const shared = m.is_shared ? '⬡ ' : '';
          const cat = m.category !== 'general' ? `[${m.category}] ` : '';
          const content = m.content.length > 200 ? m.content.slice(0, 199) + '…' : m.content;
          lines.push(`• ${hot}${shared}${cat}${content} (${date})`);
        }
      }

      if (topicEntities.length > 0) {
        lines.push('');
        lines.push('[ENTITIES]');
        for (const e of topicEntities) {
          const facts = (e.facts as Array<{ content: string }>)
            .slice(0, 3)
            .map(f => `  • ${f.content.length > 150 ? f.content.slice(0, 149) + '…' : f.content}`)
            .join('\n');
          lines.push(`${e.name} (${e.type}):\n${facts}`);
        }
      }

      lines.push('[/MEMORY]');

      // Mark context as loaded for lazy-load TTL
      await contextBundleService.markContextLoaded(userId);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    case 'memory_save': {
      const validMemoryTypes: MemoryType[] = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'];
      const validTiers = ['core', 'hot', 'warm', 'cold'] as const;
      const validCategories2: MemoryCategory[] = [
        'user_profile','meta_instructions','active_project','technical_stack',
        'preferences','workflow','domain_knowledge','decisions','constraints',
        'relationships','temporal','archive','infrastructure','credentials','shared_config','general',
      ];

      const rawType = args.type as string | undefined;
      const rawTier = args.tier as string | undefined;
      const rawCat = args.category as string | undefined;

      const memType: MemoryType = rawType && validMemoryTypes.includes(rawType as MemoryType)
        ? (rawType as MemoryType) : 'fact';
      const memTier = rawTier && validTiers.includes(rawTier as typeof validTiers[number])
        ? (rawTier as typeof validTiers[number]) : 'warm';
      const memCategory: MemoryCategory = rawCat && validCategories2.includes(rawCat as MemoryCategory)
        ? (rawCat as MemoryCategory) : 'general';

      // Resolve project_name to UUID for save as well
      let saveProjectId = typeof args.project_id === 'string' ? args.project_id : undefined;
      if (!saveProjectId && typeof args.project_name === 'string') {
        const resolved = await projectService.resolveByName(userId, args.project_name as string);
        if (resolved) saveProjectId = resolved;
      }

      const memory = await memoryService.create(userId, {
        content: args.content as string,
        type: memType,
        tier: memTier,
        category: memCategory,
        importance: typeof args.importance === 'number' ? Math.max(0, Math.min(1, args.importance)) : undefined,
        tags: Array.isArray(args.tags) ? (args.tags as string[]).slice(0, 20) : undefined,
        is_shared: typeof args.is_shared === 'boolean' ? args.is_shared : undefined,
        project_id: saveProjectId,
      });
      const sharedLabel = memory.is_shared ? ', shared: ✓' : '';
      const encLabel = memCategory === 'credentials' ? ', encrypted: ✓' : '';
      return {
        content: [{
          type: 'text',
          text: `Memory saved ✓ (id: ${memory.id}, tier: ${memory.tier}, category: ${memory.category}, type: ${memory.type}, importance: ${memory.importance}${sharedLabel}${encLabel})`,
        }],
      };
    }

    case 'memory_search': {
      const validMemoryTypes2: MemoryType[] = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'];
      const rawTypes = Array.isArray(args.types) ? args.types as string[] : undefined;
      const filteredTypes = rawTypes?.filter(t => validMemoryTypes2.includes(t as MemoryType)) as MemoryType[] | undefined;

      const results = await memoryService.search(userId, {
        query: args.query as string,
        limit: typeof args.limit === 'number' ? Math.min(Math.max(1, args.limit), 20) : undefined,
        types: filteredTypes,
        project_id: args.project_id as string | undefined,
      });
      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No memories found matching your query.' }] };
      }
      const text = results.map(m =>
        `[${m.type.toUpperCase()}] importance:${m.importance}\n${m.content}`
      ).join('\n\n');
      return { content: [{ type: 'text', text }] };
    }

    case 'entity_save': {
      const entity = await entityService.upsert(userId, {
        name: args.name as string,
        type: args.type as 'person' | 'project' | 'company' | 'tool' | 'concept' | 'place' | 'other',
        facts: args.facts as Array<{ content: string; source?: string }>,
        aliases: args.aliases as string[] | undefined,
      });
      return {
        content: [{
          type: 'text',
          text: `Entity saved: ${entity.name} (${entity.type}) with ${(entity.facts as unknown[]).length} facts`,
        }],
      };
    }

    case 'entity_get': {
      const entity = await entityService.findByName(userId, args.name as string);
      if (!entity) {
        return { content: [{ type: 'text', text: `No information found about "${args.name}".` }] };
      }
      const facts = (entity.facts as Array<{ content: string }>).map(f => `• ${f.content}`).join('\n');
      return {
        content: [{
          type: 'text',
          text: `**${entity.name}** (${entity.type})\n${facts || 'No facts stored.'}`,
        }],
      };
    }

    case 'session_end': {
      const sessionId = args.session_id as string;
      const summary = typeof args.summary === 'string' ? args.summary : undefined;

      // Use userId-scoped lookup to prevent closing other users' sessions
      const session = await sessionService.findById(userId, sessionId);
      if (!session) {
        return { content: [{ type: 'text', text: 'Session not found or access denied.' }] };
      }

      if (session.status === 'active') {
        await sessionService.close(userId, sessionId);
      }

      if (summary) {
        await memoryService.create(userId, {
          content: summary,
          type: 'summary',
          importance: 0.7,
          session_id: sessionId,
          project_id: session.project_id,
        });
      }

      // Clear lazy-load flag so next conversation gets a fresh full context load
      await contextBundleService.clearContextLoaded(userId);

      return {
        content: [{
          type: 'text',
          text: 'Session closed. Memories will be distilled and available in your next conversation.',
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ── MCP HTTP Handler ────────────────────────────────────────

async function handleMcpRequest(
  request: McpRequest,
  userId: string
): Promise<McpResponse> {
  const { id, method, params = {} } = request;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'memoryai', version: '0.1.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        };

      case 'tools/call': {
        const toolName = params.name as string;
        const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
        const result = await handleTool(toolName, toolArgs, userId);
        return { jsonrpc: '2.0', id, result };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message },
    };
  }
}

// ── Fastify Route Registration ──────────────────────────────

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  // JSON-RPC over HTTP POST
  app.post('/mcp', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey = (req.headers.authorization ?? '').replace(/^(Bearer|ApiKey)\s+/i, '');
    if (!apiKey) {
      return reply.code(401).send({ error: 'Missing API key' });
    }

    const user = await authService.findByApiKey(apiKey);
    if (!user) {
      return reply.code(401).send({ error: 'Invalid API key' });
    }

    const mcpReq = req.body as McpRequest;
    const response = await handleMcpRequest(mcpReq, user.id);
    return reply.send(response);
  });

  // SSE endpoint for MCP streaming (used by some clients)
  app.get('/mcp/sse', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey = (req.headers.authorization ?? '').replace(/^(Bearer|ApiKey)\s+/i, '');

    if (!apiKey) {
      return reply.code(401).send({ error: 'Missing API key' });
    }

    const user = await authService.findByApiKey(apiKey);
    if (!user) {
      return reply.code(401).send({ error: 'Invalid API key' });
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    // Send endpoint info
    reply.raw.write(`data: ${JSON.stringify({ type: 'endpoint', uri: '/mcp' })}\n\n`);

    // Keep alive
    const keepAlive = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 30_000);

    req.raw.on('close', () => clearInterval(keepAlive));
  });

  // MCP config endpoint — returns the config snippet to paste into Antigravity/Claude Code
  app.get('/mcp/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey = (req.headers.authorization ?? '').replace(/^(Bearer|ApiKey)\s+/i, '');
    const { MCP_SERVER_URL } = process.env;
    const baseUrl = MCP_SERVER_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;

    const antigravityConfig = {
      mcpServers: {
        memoryai: {
          serverUrl: `${baseUrl}/mcp/sse`,
          headers: { Authorization: `Bearer ${apiKey || 'YOUR_API_KEY_HERE'}` },
        },
      },
    };

    const claudeCodeConfig = {
      mcpServers: {
        memoryai: {
          type: 'http',
          url: `${baseUrl}/mcp`,
          headers: { Authorization: `Bearer ${apiKey || 'YOUR_API_KEY_HERE'}` },
        },
      },
    };

    return reply.send({
      antigravity: {
        path: '~/.gemini/antigravity/mcp_config.json',
        config: antigravityConfig,
      },
      claude_code: {
        path: '~/.claude/settings.json (mcpServers section)',
        config: claudeCodeConfig,
      },
    });
  });
}
