import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { databasePath, loadEnvFile } from "./env";
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from "./schema";

export type Db = Database.Database;

/**
 * Opens (and if necessary creates and migrates) a zcal database.
 *
 * Pass ":memory:" for tests. Everything else is treated as a file path and its
 * parent directory is created for you.
 */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Db): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const record = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );
  let count = 0;
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    })();
    count += 1;
  }
  seedSettingsRow(db);
  return count;
}

/** The settings table is a singleton; guarantee the row exists. */
function seedSettingsRow(db: Db): void {
  const existing = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (existing) return;
  db.prepare(
    `INSERT INTO settings (id, owner_name, owner_email, time_zone, calendar_name, updated_at)
     VALUES (1, '', '', ?, 'My calendar', ?)`,
  ).run(defaultTimeZone(), new Date().toISOString());
}

function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function schemaVersion(db: Db): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

export { LATEST_SCHEMA_VERSION };

/**
 * Process-wide handle for the app. Next.js keeps modules alive between
 * requests and reloads them in dev, so the handle is cached on globalThis to
 * avoid leaking file descriptors across hot reloads.
 */
const globalForDb = globalThis as unknown as { __zcalDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__zcalDb) {
    loadEnvFile();
    globalForDb.__zcalDb = openDatabase(databasePath());
  }
  return globalForDb.__zcalDb;
}

export function closeDb(): void {
  globalForDb.__zcalDb?.close();
  globalForDb.__zcalDb = undefined;
}
