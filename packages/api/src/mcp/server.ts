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
import { memoryService } from '../services/memory.service.js';
import { entityService } from '../services/entity.service.js';
import { sessionService } from '../services/session.service.js';
import { authService } from '../services/auth.service.js';
import type { McpMemoryContext, MemoryType } from '@memoryai/shared';

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
    description: `ALWAYS call this tool at the very beginning of every conversation, before your first response.
Retrieves relevant memories and entity knowledge from previous sessions to provide you with persistent context.
Returns facts, decisions, preferences, and important information from past interactions that are relevant to the current conversation topic.
Use this context to provide continuity — the user should not need to re-explain what was already discussed.`,
    inputSchema: {
      type: 'object',
      properties: {
        topics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key topics, questions, or keywords from the current conversation to search for relevant memories. Extract 3-5 main themes.',
        },
        project_id: {
          type: 'string',
          description: 'Optional project UUID to filter memories to a specific project context.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to retrieve (default: 10, max: 20).',
        },
      },
      required: ['topics'],
    },
  },
  {
    name: 'memory_save',
    description: `Save important information to persistent memory so it will be available in future conversations.
Call this whenever you learn: facts about the user or their work, decisions that were made, user preferences,
project-specific information, instructions the user wants remembered, or any context that would be useful later.
Save proactively — it's better to save too much than to lose important context.`,
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The information to remember. Write as a complete, self-contained sentence that will be understandable without the surrounding conversation.',
        },
        type: {
          type: 'string',
          enum: ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'],
          description: 'Category: fact=general info, decision=choice made, preference=user likes/dislikes, instruction=rule to follow, entity_relation=relationship between entities, summary=conversation summary.',
        },
        importance: {
          type: 'number',
          description: 'Importance score 0.0-1.0. Use 0.9+ for critical decisions/instructions, 0.7 for important facts, 0.5 for general info.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords for categorization (e.g., ["project:memoryai", "tech:typescript", "preference"]).',
        },
        project_id: {
          type: 'string',
          description: 'Optional project UUID to associate this memory with a specific project.',
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
      const topics = (args.topics as string[]).join(' ');
      const limit = Math.min((args.limit as number | undefined) ?? 10, 20);
      const projectId = args.project_id as string | undefined;

      const [memories, entities] = await Promise.all([
        memoryService.search(userId, { query: topics, limit, project_id: projectId }),
        entityService.search(userId, topics, 3),
      ]);

      const context: McpMemoryContext = {
        memories: memories.map(m => ({
          content: m.content,
          type: m.type,
          importance: m.importance,
          relevance_score: m.combined_score,
          created_at: m.created_at.toISOString(),
        })),
        entities: entities.map(e => ({
          name: e.name,
          type: e.type,
          facts: (e.facts as Array<{ content: string }>).map(f => f.content),
        })),
        total_found: memories.length,
      };

      if (context.memories.length === 0 && context.entities.length === 0) {
        return {
          content: [{ type: 'text', text: 'No relevant memories found for this topic. This may be the first conversation about it.' }],
        };
      }

      const text = formatContextForModel(context);
      return { content: [{ type: 'text', text }] };
    }

    case 'memory_save': {
      const validMemoryTypes: MemoryType[] = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'];
      const rawType = args.type as string | undefined;
      const memType: MemoryType = rawType && validMemoryTypes.includes(rawType as MemoryType)
        ? (rawType as MemoryType)
        : 'fact';

      const memory = await memoryService.create(userId, {
        content: args.content as string,
        type: memType,
        importance: typeof args.importance === 'number' ? Math.max(0, Math.min(1, args.importance)) : undefined,
        tags: Array.isArray(args.tags) ? (args.tags as string[]).slice(0, 20) : undefined,
        project_id: typeof args.project_id === 'string' ? args.project_id : undefined,
      });
      return {
        content: [{
          type: 'text',
          text: `Memory saved (id: ${memory.id}, type: ${memory.type}, importance: ${memory.importance})`,
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
        `[${m.type.toUpperCase()}] (score: ${m.combined_score.toFixed(2)}, importance: ${m.importance})\n${m.content}\n(saved: ${new Date(m.created_at).toLocaleDateString()})`
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

      return {
        content: [{
          type: 'text',
          text: 'Session closed. Memories will be distilled in the background and available in your next conversation.',
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

function formatContextForModel(ctx: McpMemoryContext): string {
  const lines: string[] = ['=== PERSISTENT MEMORY CONTEXT ===', ''];

  if (ctx.memories.length > 0) {
    lines.push('MEMORIES FROM PREVIOUS SESSIONS:');
    for (const m of ctx.memories) {
      const date = new Date(m.created_at).toLocaleDateString('pl-PL');
      lines.push(`• [${m.type.toUpperCase()}] ${m.content} (${date})`);
    }
    lines.push('');
  }

  if (ctx.entities.length > 0) {
    lines.push('KNOWN ENTITIES:');
    for (const e of ctx.entities) {
      lines.push(`• ${e.name} (${e.type}):`);
      for (const fact of e.facts.slice(0, 3)) {
        lines.push(`  - ${fact}`);
      }
    }
    lines.push('');
  }

  lines.push('=== END OF MEMORY CONTEXT ===');
  lines.push('Use this context to provide continuity. The user should not need to re-explain previously discussed topics.');

  return lines.join('\n');
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
