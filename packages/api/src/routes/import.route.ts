/**
 * Memory Import Route — POST /v1/import
 *
 * Accepts memories from external sources and normalises them into MemoryAI format.
 *
 * Supported formats:
 *   - chatgpt   : {"memories": [{"memory": "...", "created_at": "..."}]}
 *   - markdown  : plain text / Markdown bullets / paragraphs
 *   - batch     : {"memories": [{"content": "...", "type": "...", "importance": 0.7}]}
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.js';
import { memoryService } from '../services/memory.service.js';
import type { CreateMemoryDto, MemoryType } from '@memoryai/shared';

// ── Validation schemas ──────────────────────────────────────

const TYPES = ['fact', 'decision', 'preference', 'instruction', 'entity_relation', 'summary'] as const;

const importSchema = z.object({
  format: z.enum(['chatgpt', 'markdown', 'batch']),
  /** For chatgpt/batch: pass a parsed object; for markdown: pass a string directly */
  data: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]),
  source: z.string().max(100).optional(),
  project_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
});

// ── Normalised shape before bulk insert ────────────────────

interface NormalisedMemory {
  content: string;
  type: MemoryType;
  importance: number;
  tags: string[];
}

// ── Per-format parsers ──────────────────────────────────────

/**
 * ChatGPT export: {"memories": [{"memory": "...", "created_at": "..."}]}
 */
function parseChatGPT(raw: unknown): { items: NormalisedMemory[]; errors: string[] } {
  const errors: string[] = [];
  const items: NormalisedMemory[] = [];

  const schema = z.object({
    memories: z.array(z.object({
      memory: z.string(),
      created_at: z.string().optional(),
    })),
  });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    errors.push(`Invalid ChatGPT format: ${parsed.error.message}`);
    return { items, errors };
  }

  for (const entry of parsed.data.memories) {
    const content = entry.memory.trim();
    if (content.length < 3) continue;
    items.push({
      content: content.slice(0, 500),
      type: 'fact',
      importance: 0.6,
      tags: ['imported', 'chatgpt'],
    });
  }

  return { items, errors };
}

/**
 * Markdown / plain text: each bullet, numbered item, or non-empty paragraph
 * becomes a separate memory.
 */
function parseMarkdown(raw: unknown): { items: NormalisedMemory[]; errors: string[] } {
  const errors: string[] = [];
  const items: NormalisedMemory[] = [];

  if (typeof raw !== 'string') {
    errors.push('Markdown format requires data to be a string');
    return { items, errors };
  }

  const lines = raw.split('\n');
  const candidates: string[] = [];
  let paragraphBuffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Bullet or numbered list item
    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      // Flush any pending paragraph
      if (paragraphBuffer.length > 0) {
        candidates.push(paragraphBuffer.join(' ').trim());
        paragraphBuffer = [];
      }
      const stripped = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').trim();
      if (stripped) candidates.push(stripped);
      continue;
    }

    // Heading → treat as label, skip
    if (/^#+\s/.test(trimmed)) {
      if (paragraphBuffer.length > 0) {
        candidates.push(paragraphBuffer.join(' ').trim());
        paragraphBuffer = [];
      }
      continue;
    }

    // Blank line → flush paragraph
    if (trimmed === '') {
      if (paragraphBuffer.length > 0) {
        candidates.push(paragraphBuffer.join(' ').trim());
        paragraphBuffer = [];
      }
      continue;
    }

    paragraphBuffer.push(trimmed);
  }

  // Flush any remaining paragraph
  if (paragraphBuffer.length > 0) {
    candidates.push(paragraphBuffer.join(' ').trim());
  }

  for (const candidate of candidates) {
    if (candidate.length < 3) continue;
    items.push({
      content: candidate.slice(0, 500),
      type: 'fact',
      importance: 0.5,
      tags: ['imported', 'markdown'],
    });
  }

  return { items, errors };
}

/**
 * Universal batch: {"memories": [{"content": "...", "type": "fact", "importance": 0.7}]}
 */
function parseBatch(raw: unknown): { items: NormalisedMemory[]; errors: string[] } {
  const errors: string[] = [];
  const items: NormalisedMemory[] = [];

  const entrySchema = z.object({
    content: z.string().min(1).max(10_000),
    type: z.enum(TYPES).optional(),
    importance: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).max(20).optional(),
  });

  const schema = z.object({
    memories: z.array(z.unknown()),
  });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    errors.push(`Invalid batch format: ${parsed.error.message}`);
    return { items, errors };
  }

  for (let i = 0; i < parsed.data.memories.length; i++) {
    const entry = entrySchema.safeParse(parsed.data.memories[i]);
    if (!entry.success) {
      errors.push(`Entry ${i}: ${entry.error.message}`);
      continue;
    }
    items.push({
      content: entry.data.content.trim().slice(0, 500),
      type: (entry.data.type ?? 'fact') as MemoryType,
      importance: entry.data.importance ?? 0.5,
      tags: [...(entry.data.tags ?? []), 'imported'],
    });
  }

  return { items, errors };
}

// ── Route ───────────────────────────────────────────────────

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * POST /import
   *
   * Body: { format, data, source?, project_id?, session_id? }
   * Response: { imported, skipped, errors }
   */
  app.post('/import', async (req, reply) => {
    const body = importSchema.parse(req.body);

    let normalised: NormalisedMemory[];
    let parseErrors: string[];

    switch (body.format) {
      case 'chatgpt': {
        const result = parseChatGPT(body.data);
        normalised = result.items;
        parseErrors = result.errors;
        break;
      }
      case 'markdown': {
        const result = parseMarkdown(body.data);
        normalised = result.items;
        parseErrors = result.errors;
        break;
      }
      case 'batch': {
        const result = parseBatch(body.data);
        normalised = result.items;
        parseErrors = result.errors;
        break;
      }
    }

    if (normalised.length === 0) {
      return reply.send({
        imported: 0,
        skipped: 0,
        errors: parseErrors.length > 0 ? parseErrors : ['No valid memories found in the provided data'],
      });
    }

    // Build CreateMemoryDto list
    const sourceTags = body.source ? [`source:${body.source}`] : [];

    const dtos: CreateMemoryDto[] = normalised.map((m) => ({
      content: m.content,
      type: m.type,
      importance: m.importance,
      tags: [...m.tags, ...sourceTags],
      project_id: body.project_id,
      session_id: body.session_id,
    }));

    // Bulk insert in chunks of 50 to respect batch limits
    const CHUNK_SIZE = 50;
    let importedCount = 0;
    const insertErrors: string[] = [];

    for (let i = 0; i < dtos.length; i += CHUNK_SIZE) {
      const chunk = dtos.slice(i, i + CHUNK_SIZE);
      try {
        const saved = await memoryService.createBatch(req.user.id, chunk);
        importedCount += saved.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        insertErrors.push(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${msg}`);
      }
    }

    const skipped = normalised.length - importedCount;

    return reply.code(201).send({
      imported: importedCount,
      skipped,
      errors: [...parseErrors, ...insertErrors],
    });
  });
}
