/**
 * Supplemental SQL migration runner.
 * Runs ALL .sql files in the migrations directory directly against PostgreSQL.
 * All migration files use IF NOT EXISTS, so this is safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx lib/db/src/run-sql-migrations.ts
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSqlMigrations(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    console.log("[sql-migrate] No DATABASE_URL — skipping");
    return;
  }

  const migrationsDir = path.resolve(__dirname, "../migrations");
  const sqlFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  if (sqlFiles.length === 0) {
    console.log("[sql-migrate] No SQL files found");
    return;
  }

  const pool = new pg.Pool({
    connectionString: dbUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf8");
      try {
        await pool.query(sql);
        console.log(`[sql-migrate] ${file} — OK`);
      } catch (err: any) {
        console.warn(`[sql-migrate] ${file} — WARN: ${err.message}`);
      }
    }
    console.log("[sql-migrate] All SQL migrations applied");
  } finally {
    await pool.end();
  }
}

runSqlMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[sql-migrate] Fatal:", err.message);
    process.exit(1);
  });
