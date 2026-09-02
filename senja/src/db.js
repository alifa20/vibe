import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS testimonials (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT '',
    avatar      TEXT,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text        TEXT    NOT NULL,
    approved    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    approved_at TEXT,
    source_ip   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_testimonials_wall
    ON testimonials (approved, created_at DESC);
`);

const statements = {
  insert: db.prepare(`
    INSERT INTO testimonials (name, role, avatar, rating, text, source_ip)
    VALUES (@name, @role, @avatar, @rating, @text, @sourceIp)
  `),
  byId: db.prepare('SELECT * FROM testimonials WHERE id = ?'),
  approved: db.prepare(`
    SELECT * FROM testimonials
    WHERE approved = 1 AND rating >= ?
    ORDER BY created_at DESC
    LIMIT ?
  `),
  all: db.prepare('SELECT * FROM testimonials ORDER BY approved ASC, created_at DESC'),
  byApproval: db.prepare(`
    SELECT * FROM testimonials WHERE approved = ? ORDER BY created_at DESC
  `),
  setApproved: db.prepare(`
    UPDATE testimonials
    SET approved = @approved,
        approved_at = CASE WHEN @approved = 1 THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE NULL END
    WHERE id = @id
  `),
  remove: db.prepare('DELETE FROM testimonials WHERE id = ?'),
  counts: db.prepare(`
    SELECT
      COUNT(*)                                   AS total,
      COALESCE(SUM(approved = 1), 0)             AS approved,
      COALESCE(SUM(approved = 0), 0)             AS pending
    FROM testimonials
  `),
  stats: db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average
    FROM testimonials WHERE approved = 1
  `),
};

export const createTestimonial = (row) => statements.insert.run(row).lastInsertRowid;
export const getTestimonial = (id) => statements.byId.get(id);
export const listApproved = ({ limit = 200, minRating = 1 } = {}) =>
  statements.approved.all(minRating, limit);
export const listAll = (filter) => {
  if (filter === 'pending') return statements.byApproval.all(0);
  if (filter === 'approved') return statements.byApproval.all(1);
  return statements.all.all();
};
export const setApproved = (id, approved) =>
  statements.setApproved.run({ id, approved: approved ? 1 : 0 }).changes;
export const deleteTestimonial = (id) => statements.remove.run(id).changes;
export const counts = () => statements.counts.get();
export const wallStats = () => statements.stats.get();
