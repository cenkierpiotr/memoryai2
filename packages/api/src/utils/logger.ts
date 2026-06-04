/**
 * Lightweight structured logger for background workers.
 *
 * Workers run outside the Fastify request lifecycle and cannot access
 * the Fastify logger instance directly. This module provides a minimal
 * logger that matches Fastify's log level semantics without the overhead
 * of passing the logger everywhere.
 *
 * In production, messages go to stdout (info) / stderr (warn/error/debug).
 * debug() is a no-op unless NODE_ENV=development.
 */

const isDev = process.env.NODE_ENV === 'development';

export const logger = {
  info: (component: string, msg: string): void => {
    process.stdout.write(`[${new Date().toISOString()}] INFO  [${component}] ${msg}\n`);
  },
  warn: (component: string, msg: string): void => {
    process.stderr.write(`[${new Date().toISOString()}] WARN  [${component}] ${msg}\n`);
  },
  error: (component: string, msg: string): void => {
    process.stderr.write(`[${new Date().toISOString()}] ERROR [${component}] ${msg}\n`);
  },
  debug: (component: string, msg: string): void => {
    if (isDev) {
      process.stderr.write(`[${new Date().toISOString()}] DEBUG [${component}] ${msg}\n`);
    }
  },
};
