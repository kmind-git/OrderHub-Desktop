import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load the built-in SQLite module through createRequire so esbuild does not
// rewrite `node:sqlite` to the unsupported bare specifier `sqlite`.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

export type Database = import("node:sqlite").DatabaseSync;

const defaultMigrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

export function runMigrations(db: Database, migrationsDir = defaultMigrationsDir): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const file of files) {
    const version = Number.parseInt(file.split("_", 1)[0] ?? "", 10);
    if (!Number.isInteger(version) || applied.has(version)) continue;
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`failed to apply migration ${file}`, { cause: error });
    }
  }
}

export function openDatabase(dbPath: string, migrationsDir = defaultMigrationsDir): Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  runMigrations(db, migrationsDir);
  return db;
}

export function withTransaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function closeDatabase(db: Database): void {
  try {
    if (db.isOpen) db.close();
  } catch {
    // Closing a database that is already closed is not an error for shutdown.
  }
}
