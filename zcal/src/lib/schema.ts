/**
 * The whole data model, in one place.
 *
 * Migrations are a plain ordered list. Each one runs once, inside a
 * transaction, and the applied version is recorded in `schema_migrations`.
 * There is no migration tooling to install and nothing to remember to run:
 * opening the database applies whatever is outstanding.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      -- Exactly one row. There is one user of this app and one calendar.
      CREATE TABLE settings (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        owner_name    TEXT NOT NULL DEFAULT '',
        owner_email   TEXT NOT NULL DEFAULT '',
        time_zone     TEXT NOT NULL DEFAULT 'UTC',
        calendar_name TEXT NOT NULL DEFAULT 'My calendar',
        updated_at    TEXT NOT NULL
      );

      -- A shareable booking link: "30 minute intro call".
      CREATE TABLE event_types (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        slug                  TEXT NOT NULL UNIQUE,
        title                 TEXT NOT NULL,
        description           TEXT NOT NULL DEFAULT '',
        location              TEXT NOT NULL DEFAULT '',
        duration_minutes      INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
        buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_minutes BETWEEN 0 AND 240),
        buffer_after_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_minutes BETWEEN 0 AND 240),
        min_notice_minutes    INTEGER NOT NULL DEFAULT 120 CHECK (min_notice_minutes BETWEEN 0 AND 20160),
        max_days_ahead        INTEGER NOT NULL DEFAULT 30 CHECK (max_days_ahead BETWEEN 1 AND 365),
        slot_interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_interval_minutes BETWEEN 5 AND 240),
        is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        is_sample             INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
        created_at            TEXT NOT NULL
      );

      -- Recurring weekly working hours, in the owner's timezone.
      CREATE TABLE availability_rules (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
        end_minute   INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
        is_sample    INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
        CHECK (end_minute > start_minute)
      );
      CREATE INDEX idx_availability_rules_weekday ON availability_rules (weekday);

      -- The one calendar. Every busy interval the app knows about lives here,
      -- whether you typed it in, imported it, or someone booked it.
      CREATE TABLE calendar_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        uid         TEXT NOT NULL UNIQUE,
        title       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        location    TEXT NOT NULL DEFAULT '',
        starts_at   TEXT NOT NULL,
        ends_at     TEXT NOT NULL,
        source      TEXT NOT NULL CHECK (source IN ('local', 'booking', 'ics')),
        busy        INTEGER NOT NULL DEFAULT 1 CHECK (busy IN (0, 1)),
        is_sample   INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        CHECK (ends_at > starts_at)
      );
      CREATE INDEX idx_calendar_events_window ON calendar_events (starts_at, ends_at);
      CREATE INDEX idx_calendar_events_source ON calendar_events (source);

      -- A slot someone reserved. The matching row in calendar_events is what
      -- makes that time unavailable to everyone else.
      CREATE TABLE bookings (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id         TEXT NOT NULL UNIQUE,
        event_type_id     INTEGER NOT NULL REFERENCES event_types (id) ON DELETE CASCADE,
        calendar_event_id INTEGER REFERENCES calendar_events (id) ON DELETE SET NULL,
        invitee_name      TEXT NOT NULL,
        invitee_email     TEXT NOT NULL,
        notes             TEXT NOT NULL DEFAULT '',
        starts_at         TEXT NOT NULL,
        ends_at           TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
        cancel_token      TEXT NOT NULL,
        is_sample         INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
        created_at        TEXT NOT NULL,
        cancelled_at      TEXT
      );
      CREATE INDEX idx_bookings_starts ON bookings (starts_at);

      -- Blocks the obvious double-book: the same link, the same start time,
      -- twice. See the concurrency note in the README for what this does NOT
      -- protect against.
      CREATE UNIQUE INDEX idx_bookings_unique_slot
        ON bookings (event_type_id, starts_at)
        WHERE status = 'confirmed';
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
