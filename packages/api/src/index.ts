import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { authService } from './services/auth.service.js';
import { memoriesRoutes } from './routes/memories.route.js';
import { sessionsRoutes } from './routes/sessions.route.js';
import { entitiesRoutes } from './routes/entities.route.js';
import { mcpRoutes } from './mcp/server.js';
import { startDistillationWorker, scheduleStaleSessionCheck } from './jobs/distillation.worker.js';

const app = Fastify({
  logger: {
    level: config.isDev ? 'debug' : 'info',
    ...(config.isDev && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  },
  trustProxy: true,
});

// ── Plugins ─────────────────────────────────────────────────

await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});

await app.register(cors, {
  origin: config.cors.origins.includes('*') ? true : config.cors.origins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

await app.register(rateLimit, {
  global: true,
  max: config.security.rateLimitRpm,
  timeWindow: '1 minute',
  keyGenerator: (req) => {
    const auth = req.headers.authorization ?? '';
    return auth.replace(/^(Bearer|ApiKey)\s+/i, '') || req.ip;
  },
});

await app.register(sensible);

// ── Routes ───────────────────────────────────────────────────

app.get('/health', async () => ({
  status: 'ok',
  version: '0.1.0',
  timestamp: new Date().toISOString(),
}));

await app.register(memoriesRoutes, { prefix: '/v1' });
await app.register(sessionsRoutes, { prefix: '/v1' });
await app.register(entitiesRoutes, { prefix: '/v1' });
await app.register(mcpRoutes);

// ── Error Handler ────────────────────────────────────────────

app.setErrorHandler((err, _req, reply) => {
  if (err.name === 'ZodError') {
    return reply.code(400).send({
      error: 'Validation Error',
      message: 'Invalid request data',
      details: JSON.parse(err.message),
      statusCode: 400,
    });
  }

  app.log.error(err);
  const statusCode = err.statusCode ?? 500;
  return reply.code(statusCode).send({
    error: statusCode === 500 ? 'Internal Server Error' : err.message,
    message: statusCode === 500 ? 'An unexpected error occurred' : err.message,
    statusCode,
  });
});

// ── Startup ──────────────────────────────────────────────────

async function start() {
  try {
    // Verify DB connection
    await pool.query('SELECT 1');
    app.log.info('Database connected');

    // Ensure admin user exists
    await authService.ensureAdminUser();
    app.log.info('Admin user ready');

    // Start background workers
    startDistillationWorker();
    app.log.info('Distillation worker started');

    await scheduleStaleSessionCheck();
    app.log.info('Stale session checker started');

    // Start server
    await app.listen({ port: config.server.port, host: config.server.host });
    app.log.info(`MemoryAI API running on http://${config.server.host}:${config.server.port}`);
    app.log.info(`MCP server available at http://${config.server.host}:${config.server.port}/mcp`);
    app.log.info(`MCP config at http://${config.server.host}:${config.server.port}/mcp/config`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await start();
