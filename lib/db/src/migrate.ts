/**
 * Programmatic migration runner for production deployments.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx lib/db/src/migrate.ts
 *
 * Or imported and called from the API server boot sequence:
 *   import { runMigrations } from "@workspace/db/migrate";
 *   await runMigrations();
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(connectionString?: string): Promise<void> {
  const dbUrl = connectionString || process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    console.log("[migrate] No DATABASE_URL — skipping migrations (using PGlite)");
    return;
  }

  const pool = new pg.Pool({
    connectionString: dbUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    console.log("[migrate] Running database migrations...");
    const db = drizzle(pool);
    const migrationsFolder = path.resolve(__dirname, "../migrations");
    await migrate(db, { migrationsFolder });
    console.log("[migrate] Migrations complete");
  } catch (err: any) {
    console.error(`[migrate] Migration failed: ${err.message}`);
    throw err;
  } finally {
    await pool.end();
  }
}

/* Run directly: npx tsx lib/db/src/migrate.ts */
const isMainModule = process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js");
if (isMainModule) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
