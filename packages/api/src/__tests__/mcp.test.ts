/**
 * Integration tests for the MemoryAI MCP server
 *
 * Requires a live PostgreSQL + Redis connection.
 * Set these env vars before running:
 *   DATABASE_URL, REDIS_URL, ADMIN_API_KEY, ENCRYPTION_KEY, JWT_SECRET
 *
 * Skips gracefully when DATABASE_URL is not set.
 *
 * Run:
 *   DATABASE_URL=postgres://... REDIS_URL=redis://... ADMIN_API_KEY=... \
 *   ENCRYPTION_KEY=... JWT_SECRET=... \
 *   npm test --workspace=packages/api
 */

// ── Guard: skip entire suite if no DB available ──────────────
// Must happen before any dynamic import that loads config.ts,
// since config.ts throws at evaluation time when required env vars are absent.
if (!process.env.DATABASE_URL) {
  console.log('Skipping integration tests — DATABASE_URL not set');
  process.exit(0);
}

// Static imports are fine now — DATABASE_URL is confirmed present.
// The other required vars (REDIS_URL, ADMIN_API_KEY, ENCRYPTION_KEY, JWT_SECRET)
// are expected to be set alongside DATABASE_URL.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// ── Types (duplicated to avoid importing helpers before guard) ──
interface TestContext {
  app: FastifyInstance;
  apiKey: string;
}

// Lazy-loaded after guard passes
let createTestApp: () => Promise<TestContext>;
let closeTestApp: (app: FastifyInstance) => Promise<void>;
let mcpCall: (
  app: FastifyInstance,
  apiKey: string,
  tool: string,
  args: Record<string, unknown>
) => Promise<{
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}>;

// ── Suite state ──────────────────────────────────────────────

let ctx: TestContext;

before(async () => {
  // Dynamic import deferred until after the DATABASE_URL guard
  const helpers = await import('./helpers.js');
  createTestApp = helpers.createTestApp;
  closeTestApp = helpers.closeTestApp;
  mcpCall = helpers.mcpCall;

  ctx = await createTestApp();
});

after(async () => {
  if (ctx?.app && closeTestApp) {
    await closeTestApp(ctx.app);
  }
});

// ── Helpers ──────────────────────────────────────────────────

function getTextContent(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text: string }> };
  return r?.content?.[0]?.text ?? '';
}

// ── Tests ────────────────────────────────────────────────────

describe('MCP server', () => {
  test('health endpoint returns ok', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { status: string };
    assert.equal(body.status, 'ok');
  });

  test('POST /mcp returns 401 without auth', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      },
    });
    assert.equal(response.statusCode, 401);
  });

  test('tools/list returns all expected tool names', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.apiKey}`,
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      result: { tools: Array<{ name: string }> };
    };
    const toolNames = body.result.tools.map((t) => t.name);

    assert.ok(toolNames.includes('memory_save'), 'memory_save tool should be listed');
    assert.ok(toolNames.includes('memory_search'), 'memory_search tool should be listed');
    assert.ok(toolNames.includes('memory_get_context'), 'memory_get_context tool should be listed');
    assert.ok(toolNames.includes('session_end'), 'session_end tool should be listed');
    assert.ok(toolNames.includes('entity_save'), 'entity_save tool should be listed');
    assert.ok(toolNames.includes('entity_get'), 'entity_get tool should be listed');
  });

  test('memory_save saves and returns memory id', async () => {
    const response = await mcpCall(ctx.app, ctx.apiKey, 'memory_save', {
      content: 'Test memory content — integration test baseline',
      type: 'fact',
      category: 'general',
    });

    assert.ok(!response.error, `Expected no error, got: ${JSON.stringify(response.error)}`);
    assert.ok(response.result, 'Expected a result');

    const text = getTextContent(response.result);
    assert.ok(text.includes('Memory saved'), `Expected "Memory saved" in response, got: ${text}`);
    assert.ok(text.includes('id:'), `Expected "id:" in response, got: ${text}`);
  });

  test('memory_search returns results or empty message (no crash)', async () => {
    const uniqueMarker = `xyzzy_test_unique_${Date.now()}`;

    // Save a memory with a unique marker first
    const saveResponse = await mcpCall(ctx.app, ctx.apiKey, 'memory_save', {
      content: `Integration test marker: ${uniqueMarker}`,
      type: 'fact',
      category: 'general',
    });
    assert.ok(!saveResponse.error, `Save failed: ${JSON.stringify(saveResponse.error)}`);

    // Search — the call should succeed regardless of whether semantic search finds the token
    const searchResponse = await mcpCall(ctx.app, ctx.apiKey, 'memory_search', {
      query: 'integration test marker',
      limit: 10,
    });

    assert.ok(!searchResponse.error, `Search failed: ${JSON.stringify(searchResponse.error)}`);
    const text = getTextContent(searchResponse.result);
    assert.ok(
      typeof text === 'string' && text.length > 0,
      'Expected a non-empty text response from memory_search'
    );
  });

  test('memory_get_context returns a non-empty context bundle', async () => {
    const response = await mcpCall(ctx.app, ctx.apiKey, 'memory_get_context', {
      topics: ['test', 'integration'],
      force_reload: true,
    });

    assert.ok(!response.error, `Expected no error, got: ${JSON.stringify(response.error)}`);
    assert.ok(response.result, 'Expected a result');

    const text = getTextContent(response.result);
    assert.ok(typeof text === 'string' && text.length > 0, 'Expected non-empty context string');
  });

  test('session_end lifecycle: create session then close via MCP', async () => {
    // Create a session via REST API
    const createResponse = await ctx.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.apiKey}`,
      },
      payload: {
        title: 'Integration test session',
        model: 'test-model',
      },
    });

    assert.equal(
      createResponse.statusCode,
      201,
      `Expected 201 creating session, got ${createResponse.statusCode}: ${createResponse.body}`
    );

    const createBody = JSON.parse(createResponse.body) as { data: { id: string } };
    const sessionId = createBody.data.id;
    assert.ok(typeof sessionId === 'string' && sessionId.length > 0, 'Expected session id');

    // End the session via MCP
    const endResponse = await mcpCall(ctx.app, ctx.apiKey, 'session_end', {
      session_id: sessionId,
      summary: 'Integration test session summary',
    });

    assert.ok(!endResponse.error, `Expected no error, got: ${JSON.stringify(endResponse.error)}`);

    const text = getTextContent(endResponse.result);
    assert.ok(
      text.toLowerCase().includes('session') && (text.toLowerCase().includes('closed') || text.toLowerCase().includes('distill')),
      `Expected session closure confirmation, got: ${text}`
    );
  });

  test('memory_save with credentials category returns encrypted marker', async () => {
    const response = await mcpCall(ctx.app, ctx.apiKey, 'memory_save', {
      content: 'api_key=secret_integration_test_value_12345',
      type: 'fact',
      category: 'credentials',
    });

    assert.ok(
      !response.error,
      `Expected no error saving credentials memory, got: ${JSON.stringify(response.error)}`
    );
    assert.ok(response.result, 'Expected a result');

    const text = getTextContent(response.result);
    assert.ok(text.includes('Memory saved'), `Expected "Memory saved" in response, got: ${text}`);
    assert.ok(
      text.includes('encrypted: ✓'),
      `Expected "encrypted: ✓" for credentials category, got: ${text}`
    );
  });

  test('memory_save with unknown category falls back to general', async () => {
    const response = await mcpCall(ctx.app, ctx.apiKey, 'memory_save', {
      content: 'Memory with unknown category should fall back to general',
      type: 'fact',
      category: 'totally_invalid_category_xyz',
    });

    // MCP server normalises unknown categories to 'general' — should succeed
    assert.ok(!response.error, `Expected no error, got: ${JSON.stringify(response.error)}`);
    const text = getTextContent(response.result);
    assert.ok(text.includes('Memory saved'), `Expected success with fallback, got: ${text}`);
    assert.ok(text.includes('general'), `Expected category to fall back to general, got: ${text}`);
  });

  test('session_end with nonexistent session_id returns user-facing not-found message', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await mcpCall(ctx.app, ctx.apiKey, 'session_end', {
      session_id: fakeId,
    });

    // Should return a result (not a JSON-RPC error envelope) with a readable message
    assert.ok(
      !response.error,
      `Expected no JSON-RPC error envelope, got: ${JSON.stringify(response.error)}`
    );
    const text = getTextContent(response.result);
    assert.ok(
      text.toLowerCase().includes('not found') || text.toLowerCase().includes('access denied'),
      `Expected "not found" message, got: ${text}`
    );
  });
});
