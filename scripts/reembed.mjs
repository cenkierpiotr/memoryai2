#!/usr/bin/env node
/**
 * Re-embedding script — run after switching embedding model.
 *
 * Usage:
 *   node scripts/reembed.mjs
 *
 * Or with Docker:
 *   docker exec memoryai-api node dist/scripts/reembed.mjs
 *
 * Re-embeds all memories and entities where embedding IS NULL.
 * Safe to run multiple times (idempotent).
 */

import 'dotenv/config';
import pg from 'pg';
import fetch from 'node-fetch';

const DB_URL = process.env.DATABASE_URL;
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'mxbai-embed-large';
const BATCH_SIZE = 16;

if (!DB_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DB_URL, max: 3 });

async function embedBatch(texts) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Embed failed: ${res.status}`);
  const data = await res.json();
  return data.embeddings;
}

function toVector(arr) {
  return `[${arr.join(',')}]`;
}

async function reembedTable(table, contentCol = 'content') {
  const { rows: nullRows } = await pool.query(
    `SELECT id, ${contentCol} FROM ${table} WHERE embedding IS NULL ORDER BY created_at ASC`
  );

  if (nullRows.length === 0) {
    console.log(`  ${table}: all embeddings present, nothing to do.`);
    return 0;
  }

  console.log(`  ${table}: re-embedding ${nullRows.length} rows...`);
  let done = 0;

  for (let i = 0; i < nullRows.length; i += BATCH_SIZE) {
    const batch = nullRows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(r => r[contentCol] || '');

    try {
      const embeddings = await embedBatch(texts);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let j = 0; j < batch.length; j++) {
          await client.query(
            `UPDATE ${table} SET embedding = $1::vector WHERE id = $2`,
            [toVector(embeddings[j]), batch[j].id]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      done += batch.length;
      process.stdout.write(`\r    Progress: ${done}/${nullRows.length}`);
    } catch (err) {
      console.error(`\n    Batch ${i}-${i+BATCH_SIZE} failed: ${err.message}`);
    }
  }

  console.log(`\n  ${table}: done (${done}/${nullRows.length} re-embedded)`);
  return done;
}

async function main() {
  console.log(`Re-embedding with model: ${EMBED_MODEL} at ${OLLAMA_URL}`);
  console.log('');

  // Test connection
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: ['test'] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const dims = data.embeddings[0].length;
    console.log(`✓ Ollama connected. Model: ${EMBED_MODEL}, dimensions: ${dims}`);
    console.log('');
  } catch (err) {
    console.error(`✗ Cannot reach Ollama: ${err.message}`);
    process.exit(1);
  }

  const memsDone = await reembedTable('memories', 'content');
  const entsDone = await reembedTable('entities', 'name');

  console.log('');
  console.log(`Done. Memories: ${memsDone}, Entities: ${entsDone}`);
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
