import type { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth.service.js';
import type { User } from '@memoryai/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Missing Authorization header', statusCode: 401 });
    return;
  }

  let apiKey: string | undefined;

  if (authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.slice(7);
  } else if (authHeader.startsWith('ApiKey ')) {
    apiKey = authHeader.slice(7);
  }

  if (!apiKey) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Invalid Authorization header format', statusCode: 401 });
    return;
  }

  const user = await authService.findByApiKey(apiKey);
  if (!user) {
    // Constant-time response to prevent timing attacks
    await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
    reply.code(401).send({ error: 'Unauthorized', message: 'Invalid API key', statusCode: 401 });
    return;
  }

  request.user = user;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (!request.user?.is_admin) {
    reply.code(403).send({ error: 'Forbidden', message: 'Admin access required', statusCode: 403 });
  }
}
