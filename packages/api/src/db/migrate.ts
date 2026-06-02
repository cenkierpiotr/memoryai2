import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export async function runMigrations(): Promise<void> {
  // Ensure schema_migrations table exists (outside any per-migration transaction)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Read all .sql files, sorted alphabetically
  let files: string[];
  try {
    const entries = await readdir(MIGRATIONS_DIR);
    files = entries.filter((f) => f.endsWith('.sql')).sort();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[migrate] Cannot read migrations directory: ${message}\n`);
    throw err;
  }

  if (files.length === 0) {
    process.stdout.write('[migrate] No migration files found.\n');
    return;
  }

  // Fetch already-applied migrations
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations'
  );
  const applied = new Set(rows.map((r) => r.filename));

  for (const filename of files) {
    if (applied.has(filename)) {
      continue; // already applied — skip
    }

    const filePath = join(MIGRATIONS_DIR, filename);
    const sql = await readFile(filePath, 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
      process.stdout.write(`[migrate] Applied: ${filename}\n`);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[migrate] FAILED: ${filename} — ${message}\n`);
      throw err;
    } finally {
      client.release();
    }
  }
}

// Run directly: node dist/db/migrate.js
if (process.argv[1]?.endsWith('migrate.js')) {
  runMigrations().then(() => process.exit(0)).catch(() => process.exit(1));
}
