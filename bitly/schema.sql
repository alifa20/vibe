-- Slug metadata. KV holds the copy the redirect path reads; this table is the
-- authority for uniqueness, the click counter, and everything the admin shows.
CREATE TABLE IF NOT EXISTS links (
  slug         TEXT    PRIMARY KEY,
  target_url   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,          -- epoch ms
  expires_at   INTEGER,                   -- epoch ms, NULL = never
  max_clicks   INTEGER,                   -- NULL = uncapped
  fallback_url TEXT,                      -- overrides FALLBACK_URL for this link
  click_count  INTEGER NOT NULL DEFAULT 0,
  disabled     INTEGER NOT NULL DEFAULT 0,
  note         TEXT
);

-- One row per click, written from ctx.waitUntil after the 302 has gone out.
CREATE TABLE IF NOT EXISTS clicks (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  slug    TEXT    NOT NULL,
  ts      INTEGER NOT NULL,               -- epoch ms
  day     TEXT    NOT NULL,               -- YYYY-MM-DD (UTC), so per-day rollups never parse timestamps
  country TEXT,                           -- request.cf.country
  city    TEXT,                           -- request.cf.city
  device  TEXT,                           -- desktop | mobile | tablet | bot | unknown
  referer TEXT,
  outcome TEXT    NOT NULL DEFAULT 'ok'   -- ok | expired | capped | disabled
);

CREATE INDEX IF NOT EXISTS clicks_slug_ts  ON clicks (slug, ts);
CREATE INDEX IF NOT EXISTS clicks_ts       ON clicks (ts);
CREATE INDEX IF NOT EXISTS clicks_slug_day ON clicks (slug, day);
