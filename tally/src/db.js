'use strict';

const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS forms (
    id               INTEGER PRIMARY KEY,
    slug             TEXT NOT NULL UNIQUE,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    accent_color     TEXT NOT NULL DEFAULT '#2f6fed',
    submit_label     TEXT NOT NULL DEFAULT 'Submit',
    success_message  TEXT NOT NULL DEFAULT 'Thanks — your response has been recorded.',
    is_open          INTEGER NOT NULL DEFAULT 1,
    notify_email     INTEGER NOT NULL DEFAULT 0,
    notify_email_to  TEXT NOT NULL DEFAULT '',
    webhook_url      TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fields (
    id           INTEGER PRIMARY KEY,
    form_id      INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    type         TEXT NOT NULL,
    key          TEXT NOT NULL,
    label        TEXT NOT NULL,
    help_text    TEXT NOT NULL DEFAULT '',
    placeholder  TEXT NOT NULL DEFAULT '',
    options      TEXT NOT NULL DEFAULT '[]',
    required     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (form_id, key)
  );

  CREATE INDEX IF NOT EXISTS idx_fields_form ON fields (form_id, position);

  CREATE TABLE IF NOT EXISTS responses (
    id          INTEGER PRIMARY KEY,
    form_id     INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ip          TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_responses_form ON responses (form_id, id DESC);

  CREATE TABLE IF NOT EXISTS uploads (
    id             INTEGER PRIMARY KEY,
    response_id    INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
    field_key      TEXT NOT NULL,
    original_name  TEXT NOT NULL,
    stored_path    TEXT NOT NULL,
    mime_type      TEXT NOT NULL DEFAULT '',
    size_bytes     INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_uploads_response ON uploads (response_id);
`);

module.exports = db;
