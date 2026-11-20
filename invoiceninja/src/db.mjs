import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Versioned schema. Each migration runs once, inside a transaction, and is
 * recorded in schema_migrations. Add new entries at the end; never edit one
 * that has shipped.
 *
 * The rules that keep money honest live here, not in the UI:
 * - a sent, paid or void invoice cannot change its number, dates, snapshots,
 *   currency or totals, and its lines cannot be inserted, edited or deleted;
 * - status only moves draft->sent, sent->paid, sent->void or paid->void;
 * - only drafts can be deleted.
 */
const FROZEN_INVOICE_COLUMNS = [
  'number', 'year', 'client_id', 'currency', 'notes', 'issue_date', 'due_date',
  'seller_name', 'seller_email', 'seller_address', 'seller_tax_id', 'seller_payment_details',
  'client_name', 'client_email', 'client_address', 'client_tax_id',
  'subtotal', 'tax_total', 'total', 'tax_breakdown', 'created_at',
];

const frozenChanged = FROZEN_INVOICE_COLUMNS.map((c) => `NEW.${c} IS NOT OLD.${c}`).join(' OR ');

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE settings (
        id                 INTEGER PRIMARY KEY CHECK (id = 1),
        business_name      TEXT    NOT NULL DEFAULT '',
        business_email     TEXT    NOT NULL DEFAULT '',
        business_address   TEXT    NOT NULL DEFAULT '',
        business_tax_id    TEXT    NOT NULL DEFAULT '',
        payment_details    TEXT    NOT NULL DEFAULT '',
        default_currency   TEXT    NOT NULL DEFAULT 'USD',
        payment_terms_days INTEGER NOT NULL DEFAULT 14 CHECK (payment_terms_days BETWEEN 0 AND 365),
        page_size          TEXT    NOT NULL DEFAULT 'A4' CHECK (page_size IN ('A4', 'Letter')),
        timezone           TEXT    NOT NULL DEFAULT 'UTC'
      );

      CREATE TABLE clients (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        email      TEXT NOT NULL DEFAULT '',
        address    TEXT NOT NULL DEFAULT '',
        tax_id     TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE invoices (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        status                 TEXT    NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'sent', 'paid', 'void')),
        number                 TEXT    UNIQUE,
        year                   INTEGER,
        client_id              INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        currency               TEXT    NOT NULL,
        notes                  TEXT    NOT NULL DEFAULT '',
        issue_date             TEXT,
        due_date               TEXT,
        seller_name            TEXT,
        seller_email           TEXT,
        seller_address         TEXT,
        seller_tax_id          TEXT,
        seller_payment_details TEXT,
        client_name            TEXT,
        client_email           TEXT,
        client_address         TEXT,
        client_tax_id          TEXT,
        subtotal               INTEGER,
        tax_total              INTEGER,
        total                  INTEGER,
        tax_breakdown          TEXT,
        paid_date              TEXT,
        payment_method         TEXT,
        voided_at              TEXT,
        created_at             TEXT    NOT NULL,
        updated_at             TEXT    NOT NULL,
        CHECK (status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL
                                    AND due_date IS NOT NULL AND total IS NOT NULL)),
        CHECK (status <> 'paid' OR paid_date IS NOT NULL)
      );

      CREATE INDEX idx_invoices_status ON invoices (status);

      CREATE TABLE invoice_lines (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        description TEXT    NOT NULL,
        qty_milli   INTEGER NOT NULL CHECK (qty_milli >= 0),
        unit_price  INTEGER NOT NULL,
        tax_rate_bp INTEGER NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000)
      );

      CREATE INDEX idx_lines_invoice ON invoice_lines (invoice_id, position);

      CREATE TABLE counters (
        year  INTEGER PRIMARY KEY,
        value INTEGER NOT NULL
      );

      CREATE TRIGGER invoices_frozen_columns
      BEFORE UPDATE ON invoices
      WHEN OLD.status <> 'draft' AND (${frozenChanged})
      BEGIN
        SELECT RAISE(ABORT, 'invoice is frozen: only status and payment fields may change');
      END;

      CREATE TRIGGER invoices_status_moves
      BEFORE UPDATE OF status ON invoices
      WHEN NEW.status IS NOT OLD.status AND NOT (
        (OLD.status = 'draft' AND NEW.status = 'sent') OR
        (OLD.status = 'sent'  AND NEW.status IN ('paid', 'void')) OR
        (OLD.status = 'paid'  AND NEW.status = 'void')
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid invoice status change');
      END;

      CREATE TRIGGER invoices_void_final
      BEFORE UPDATE ON invoices
      WHEN OLD.status = 'void'
      BEGIN
        SELECT RAISE(ABORT, 'a void invoice cannot change');
      END;

      CREATE TRIGGER invoices_delete_draft_only
      BEFORE DELETE ON invoices
      WHEN OLD.status <> 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'only draft invoices can be deleted');
      END;

      CREATE TRIGGER lines_insert_draft_only
      BEFORE INSERT ON invoice_lines
      WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'invoice is frozen: lines cannot change');
      END;

      CREATE TRIGGER lines_update_draft_only
      BEFORE UPDATE ON invoice_lines
      WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'
        OR (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'invoice is frozen: lines cannot change');
      END;

      CREATE TRIGGER lines_delete_draft_only
      BEFORE DELETE ON invoice_lines
      WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'invoice is frozen: lines cannot change');
      END;
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1).version;

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      record.run(m.version, m.name, new Date().toISOString());
    }).immediate();
  }
}

/** The server's own zone, used as the default `timezone` setting. */
export function serverTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Opens (and if needed creates) the database. ':memory:' is fine for tests.
 * Pass `timezone` to seed the settings row on first run.
 */
export function openDb(file = ':memory:', { timezone = serverTimeZone(), busyTimeout = 5000 } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${Number(busyTimeout) | 0}`);
  migrate(db);
  db.prepare('INSERT OR IGNORE INTO settings (id, timezone) VALUES (1, ?)').run(timezone);
  return db;
}
