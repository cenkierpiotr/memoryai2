/**
 * OpenAI-compatible proxy that injects MemoryAI context into every chat request.
 *
 * Drop-in replacement for the OpenAI API — point any OpenAI SDK to this endpoint:
 *
 *   openai = new OpenAI({ baseURL: 'https://your-memoryai/proxy', apiKey: 'mai_...' })
 *
 * Flow per request:
 *   1. Extract last user message as search query
 *   2. Load relevant memories from MemoryAI (parallel with step 3)
 *   3. Create / reuse a MemoryAI session (keyed by x-session-id header)
 *   4. Prepend [MEMORYAI CONTEXT] block to the system message
 *   5. Forward to configured backend (PROXY_BACKEND_URL + PROXY_BACKEND_API_KEY)
 *   6. Save user + assistant messages to session (async, non-blocking)
 *   7. Return response (including streaming) unchanged
 *
 * Configure via .env:
 *   PROXY_BACKEND_URL     = https://api.openai.com   (default)
 *   PROXY_BACKEND_API_KEY = sk-...                   (required for OpenAI/Anthropic)
 *
 * Or configure per-user via dashboard Settings → Model Configuration.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.middleware.js';
import { memoryService } from '../services/memory.service.js';
import { embeddingService } from '../services/embedding.service.js';
import { sessionService } from '../services/session.service.js';
import { query } from '../db/pool.js';

const DEFAULT_BACKEND = 'https://api.openai.com';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | { type: string; text?: string }[];
  name?: string;
}

interface ChatCompletionsBody {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

function extractText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text!)
    .join(' ');
}

function lastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return extractText(messages[i].content);
  }
  return '';
}

async function getBackendKey(userId: string): Promise<string> {
  const res = await query<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = $1 AND key = 'proxy.backendApiKey'`,
    [userId]
  );
  return res.rows[0]?.value ?? process.env.PROXY_BACKEND_API_KEY ?? '';
}

async function getBackendUrl(userId: string): Promise<string> {
  const res = await query<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = $1 AND key = 'proxy.backendUrl'`,
    [userId]
  );
  return (res.rows[0]?.value ?? process.env.PROXY_BACKEND_URL ?? DEFAULT_BACKEND).replace(/\/$/, '');
}

export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // POST /proxy/v1/chat/completions
  app.post('/proxy/v1/chat/completions', {
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user.id;
    const body = req.body as ChatCompletionsBody;
    const sessionIdHeader = (req.headers['x-session-id'] as string | undefined) ?? undefined;
    const projectName = (req.headers['x-project'] as string | undefined) ?? undefined;

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.code(400).send({ error: { message: 'messages array required', type: 'invalid_request_error' } });
    }

    const userQuery = lastUserMessage(body.messages);

    // Parallel: load memories + get/create session
    const [memories, sessionId, backendUrl, backendKey] = await Promise.all([
      userQuery
        ? memoryService.search(userId, {
            query: userQuery,
            limit: 6,
            ...(projectName && {}), // project_name resolved via service
          }).catch(() => [])
        : Promise.resolve([]),
      (async () => {
        if (sessionIdHeader) return sessionIdHeader;
        const session = await sessionService.create(userId, {
          title: userQuery.slice(0, 60) || 'Proxy session',
          model: body.model,
          ...(projectName ? {} : {}),
        });
        return session.id;
      })(),
      getBackendUrl(userId),
      getBackendKey(userId),
    ]);

    // Build [MEMORYAI CONTEXT] block
    const contextLines: string[] = [];
    if (memories.length > 0) {
      contextLines.push('[MEMORYAI CONTEXT — from previous sessions, use when relevant]');
      for (const m of memories) {
        contextLines.push(`- [${m.type}] ${m.content}`);
      }
      contextLines.push('[/MEMORYAI CONTEXT]');
    }
    const contextBlock = contextLines.join('\n');

    // Inject into messages: prepend to system message or insert new one
    const messages: ChatMessage[] = [...body.messages];
    if (contextBlock) {
      const sysIdx = messages.findIndex(m => m.role === 'system');
      if (sysIdx >= 0) {
        const existing = extractText(messages[sysIdx].content);
        messages[sysIdx] = { role: 'system', content: `${existing}\n\n${contextBlock}` };
      } else {
        messages.unshift({ role: 'system', content: contextBlock });
      }
    }

    // Forward to backend
    const forwardBody = { ...body, messages };
    let backendRes: Response;
    try {
      backendRes = await fetch(`${backendUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${backendKey}`,
          ...(req.headers['openai-organization']
            ? { 'OpenAI-Organization': req.headers['openai-organization'] as string }
            : {}),
        },
        body: JSON.stringify(forwardBody),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      return reply.code(502).send({
        error: { message: `Proxy backend unreachable: ${err instanceof Error ? err.message : String(err)}`, type: 'proxy_error' },
      });
    }

    // Relay status + headers
    reply.code(backendRes.status);
    const ct = backendRes.headers.get('content-type') ?? 'application/json';
    reply.header('Content-Type', ct);
    reply.header('x-memoryai-session-id', sessionId);
    if (memories.length > 0) {
      reply.header('x-memoryai-memories', String(memories.length));
    }

    if (body.stream) {
      // Stream: pipe response body directly, then save messages async
      const reader = backendRes.body;
      if (!reader) return reply.send('');

      let assistantContent = '';

      // Collect stream + pipe
      const transform = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          const text = new TextDecoder().decode(chunk);
          // Extract delta content from SSE lines
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
            try {
              const json = JSON.parse(line.slice(6));
              assistantContent += json.choices?.[0]?.delta?.content ?? '';
            } catch { /* ignore */ }
          }
        },
      });

      const piped = reader.pipeThrough(transform);

      // tee() splits into two independent readers: one for the client, one to capture content
      const [forClient, forCapture] = piped.tee();

      void (async () => {
        const captureReader = forCapture.getReader();
        try { while (!(await captureReader.read()).done) { /* drain to allow transform to run */ } } catch { /* ignore */ }
        if (userQuery && sessionId) {
          await sessionService.addMessage(userId, sessionId, { role: 'user', content: userQuery }).catch(() => {});
          if (assistantContent) {
            await sessionService.addMessage(userId, sessionId, { role: 'assistant', content: assistantContent }).catch(() => {});
          }
        }
      })();

      return reply.send(forClient);
    }

    // Non-streaming: read full response
    const json = await backendRes.json() as Record<string, unknown>;

    // Save session messages async
    if (userQuery && sessionId) {
      const assistantMsg = (json.choices as Array<{ message?: { content?: string } }> | undefined)
        ?.[0]?.message?.content ?? '';
      void Promise.all([
        sessionService.addMessage(userId, sessionId, { role: 'user', content: userQuery }),
        assistantMsg
          ? sessionService.addMessage(userId, sessionId, { role: 'assistant', content: assistantMsg })
          : Promise.resolve(null),
      ]).catch(() => {});
    }

    return reply.send(json);
  });
}
