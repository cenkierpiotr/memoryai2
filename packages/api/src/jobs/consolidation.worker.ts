/**
 * Temporal Memory Consolidation Worker
 *
 * Analogia do ludzkiej pamięci:
 *   - Pamięć krótkotrwała (temporal) → pamięć długotrwała po kilku dniach
 *   - Często dostępne/ważne → konsolidacja do odpowiedniej kategorii
 *   - Rzadko dostępne/nieważne → archiwizacja (zapomnienie)
 *
 * Uruchamiane co 4 godziny, procesuje temporal memories
 * gdzie consolidation_at <= NOW() i status = 'pending'.
 */

import { query } from '../db/pool.js';
import { memoryService } from '../services/memory.service.js';
import { embeddingService } from '../services/embedding.service.js';
import { config } from '../config.js';
import type { MemoryCategory } from '@memoryai/shared';

// ── LLM call (reuses config.distillation provider) ─────────

async function callLLM(prompt: string): Promise<string> {
  switch (config.distillation.provider) {
    case 'gemini': {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.distillation.model}:generateContent?key=${config.distillation.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 },
          }),
        }
      );
      const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
      return data.candidates[0]?.content.parts[0]?.text ?? '';
    }
    default: {
      const res = await fetch(`${config.distillation.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.distillation.model,
          prompt,
          stream: false,
          options: { temperature: 0.1 },
        }),
      });
      const data = await res.json() as { response: string };
      return data.response;
    }
  }
}

const CONSOLIDATION_PROMPT = (content: string, createdAt: string, accessCount: number, importance: number) =>
  `You are a memory consolidation system. Evaluate this time-sensitive memory after ${Math.round((Date.now() - new Date(createdAt).getTime()) / 86400000)} days.

TEMPORAL MEMORY:
Content: "${content}"
Created: ${new Date(createdAt).toLocaleDateString()}
Access count: ${accessCount}
Importance: ${importance}

Decision rules:
- CONSOLIDATE if: contains lasting insight, decision, fact, or learning worth remembering permanently
- ARCHIVE if: was routine scheduling noise, time-specific event with no lasting value, or trivial

If CONSOLIDATE: rewrite as a timeless, concise long-term memory (max 150 chars).
Remove specific dates/times. Extract the lasting fact or insight.

Return ONLY valid JSON:
{
  "action": "consolidate" | "archive",
  "content": "Timeless rewrite (only if consolidate)",
  "category": "decisions|domain_knowledge|relationships|workflow|technical_stack|active_project|general",
  "importance": 0.0-1.0
}

Examples:
- "Meeting tomorrow with John about API design" → archive
- "API rate limit is 100 req/min — causes 429s in prod" → consolidate → "API rate limit: 100 req/min/user. Exceeding causes 429 in prod" [technical_stack, 0.8]
- "Decided to delay launch until load testing passes" → consolidate → "Policy: always complete load testing before launch" [decisions, 0.85]
- "Call at 3pm moved to Friday" → archive`;

interface ConsolidationDecision {
  action: 'consolidate' | 'archive';
  content?: string;
  category?: string;
  importance?: number;
}

// ── Main consolidation logic ────────────────────────────────

async function consolidateMemory(memId: string, userId: string): Promise<void> {
  const mem = await memoryService.findById(userId, memId);
  if (!mem || mem.category !== 'temporal') return;

  let decision: ConsolidationDecision;

  // Fast path: very low importance + never accessed → archive without LLM call
  if (mem.importance < 0.4 && mem.access_count === 0) {
    decision = { action: 'archive' };
  } else {
    const raw = await callLLM(CONSOLIDATION_PROMPT(
      mem.content, mem.created_at.toString(), mem.access_count, mem.importance
    ));
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('no JSON');
      decision = JSON.parse(match[0]) as ConsolidationDecision;
    } catch {
      // Fallback: if high importance/access → consolidate as-is, else archive
      decision = (mem.importance >= 0.7 || mem.access_count >= 2)
        ? { action: 'consolidate', content: mem.content, category: 'general', importance: mem.importance }
        : { action: 'archive' };
    }
  }

  if (decision.action === 'consolidate' && decision.content) {
    const validCategories: MemoryCategory[] = [
      'decisions','domain_knowledge','relationships','workflow',
      'technical_stack','active_project','general',
    ];
    const category: MemoryCategory = validCategories.includes(decision.category as MemoryCategory)
      ? decision.category as MemoryCategory
      : 'general';

    // Create the new long-term memory
    const embedding = await embeddingService.embed(decision.content);
    const vectorLiteral = embeddingService.toVectorLiteral(embedding);

    await query(
      `INSERT INTO memories
         (user_id, project_id, tier, category, type, content, importance,
          tags, language, metadata, embedding, consolidation_status)
       VALUES ($1, $2, 'warm', $3, 'fact', $4, $5, $6, $7,
               '{"consolidated_from": "' || $8 || '"}'::jsonb,
               $9::vector, 'consolidated')`,
      [
        userId,
        mem.project_id ?? null,
        category,
        decision.content.slice(0, 500),
        Math.max(0, Math.min(1, decision.importance ?? mem.importance)),
        mem.tags ?? [],
        mem.language ?? 'auto',
        memId,
        vectorLiteral,
      ]
    );

    // Link original → new (supersedes relationship)
    const newMem = await query<{ id: string }>(
      `SELECT id FROM memories WHERE user_id = $1 AND metadata->>'consolidated_from' = $2 ORDER BY created_at DESC LIMIT 1`,
      [userId, memId]
    );
    if (newMem.rows[0]) {
      await query(
        `INSERT INTO memory_links (source_id, target_memory_id, link_type) VALUES ($1, $2, 'supersedes') ON CONFLICT DO NOTHING`,
        [newMem.rows[0].id, memId]
      );
    }
  }

  // Archive the original temporal memory regardless of decision
  await query(
    `UPDATE memories SET tier = 'cold', consolidation_status = $1 WHERE id = $2`,
    [decision.action === 'consolidate' ? 'consolidated' : 'archived', memId]
  );
}

// ── Importance decay ────────────────────────────────────────

async function runImportanceDecay(): Promise<void> {
  const result = await query<{ id: string }>(
    `UPDATE memories
     SET tier = 'warm', updated_at = NOW()
     WHERE tier = 'hot'
       AND last_accessed_at < NOW() - INTERVAL '30 days'
       AND pinned = FALSE
     RETURNING id`
  );
  if (result.rows.length > 0) {
    process.stderr.write(`[importance-decay] demoted ${result.rows.length} hot → warm memories\n`);
  }
}

// ── Scheduled checker ───────────────────────────────────────

let consolidationInterval: NodeJS.Timeout | null = null;

export async function scheduleConsolidationCheck(): Promise<void> {
  async function check() {
    try {
      const due = await query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM memories
         WHERE category = 'temporal'
           AND consolidation_status = 'pending'
           AND consolidation_at <= NOW()
         ORDER BY consolidation_at ASC
         LIMIT 20`
      );

      for (const row of due.rows) {
        await consolidateMemory(row.id, row.user_id).catch((err: Error) => {
          process.stderr.write(`[consolidation] failed for ${row.id}: ${err.message}\n`);
        });
      }

      if (due.rows.length > 0) {
        process.stderr.write(`[consolidation] processed ${due.rows.length} temporal memories\n`);
      }

      await runImportanceDecay().catch((err: Error) => {
        process.stderr.write(`[importance-decay] failed: ${err.message}\n`);
      });
    } catch (err) {
      process.stderr.write(`[consolidation] check failed: ${(err as Error).message}\n`);
    }
  }

  await check();
  // Run every 4 hours
  consolidationInterval = setInterval(check, 4 * 60 * 60 * 1000);
}

export function stopConsolidationCheck(): void {
  if (consolidationInterval) {
    clearInterval(consolidationInterval);
    consolidationInterval = null;
  }
}
