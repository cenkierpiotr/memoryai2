/**
 * Integration test helpers for MemoryAI API
 *
 * Builds a Fastify app with all plugins and routes registered,
 * but does NOT call app.listen() — uses app.inject() instead.
 * This avoids needing a real TCP socket and keeps tests self-contained.
 */

import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { config } from '../config.js';
import { memoriesRoutes } from '../routes/memories.route.js';
import { sessionsRoutes } from '../routes/sessions.route.js';
import { entitiesRoutes } from '../routes/entities.route.js';
import { projectsRoutes } from '../routes/projects.route.js';
import { adminRoutes } from '../routes/admin.route.js';
import { mcpRoutes } from '../mcp/server.js';

export interface TestContext {
  app: FastifyInstance;
  apiKey: string;
}

/**
 * Create and initialize a Fastify instance with all routes registered.
 * Does NOT start the HTTP server — use app.inject() for requests.
 */
export async function createTestApp(): Promise<TestContext> {
  const app = Fastify({
    logger: false, // suppress logs in test output
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.register(sensible);

  // Health route
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  // All API routes
  await app.register(memoriesRoutes, { prefix: '/v1' });
  await app.register(sessionsRoutes, { prefix: '/v1' });
  await app.register(entitiesRoutes, { prefix: '/v1' });
  await app.register(projectsRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1' });
  await app.register(mcpRoutes);

  // Error handler (mirrors index.ts)
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.name === 'ZodError') {
      return reply.code(400).send({
        error: 'Validation Error',
        message: 'Invalid request data',
        details: JSON.parse(err.message),
        statusCode: 400,
      });
    }
    const statusCode = err.statusCode ?? 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : err.message,
      message: statusCode === 500 ? 'An unexpected error occurred' : err.message,
      statusCode,
    });
  });

  // Initialize Fastify (resolves all plugin registrations)
  await app.ready();

  const apiKey = process.env.TEST_API_KEY ?? config.auth.adminApiKey;

  return { app, apiKey };
}

/**
 * Close the Fastify app and release all connections.
 */
export async function closeTestApp(app: FastifyInstance): Promise<void> {
  await app.close();
}

/**
 * Make a JSON-RPC MCP tools/call request using app.inject().
 * Returns the full parsed response body.
 */
export async function mcpCall(
  app: FastifyInstance,
  apiKey: string,
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<{
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}> {
  const response = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs,
      },
    },
  });

  return JSON.parse(response.body) as {
    jsonrpc: string;
    id: number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  };
}
