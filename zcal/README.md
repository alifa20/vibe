# zcal

A private, single-user scheduling tool you run yourself.

It does one loop, completely:

> **read one calendar → publish your free time → someone reserves a slot → the meeting is written back to that calendar**

There are no accounts, no analytics, no telemetry, no third-party services. Your data is one
SQLite file on your own disk.

---

## Contents

- [Quick start](#quick-start)
- [Scripts](#scripts)
- [How to use it](#how-to-use-it)
- [Permissions and access](#permissions-and-access)
- [Architecture](#architecture)
- [Where your data lives](#where-your-data-lives)
- [Backup and restore](#backup-and-restore)
- [The optional calendar feed](#the-optional-calendar-feed-and-what-happens-without-it)
- [Sample data](#sample-data)
- [Testing](#testing)
- [Security notes](#security-notes)
- [Limitations](#limitations)

---

## Quick start

Requires **Node.js 20.9 or newer** (developed and tested on Node 24). Nothing else — no Docker,
no database server, no cloud account.

```bash
npm run bootstrap     # installs dependencies, writes .env, migrates, adds sample data
npm run dev           # http://localhost:3000
```

`bootstrap` prints a generated passphrase. That is your login. It is stored in `.env`, which is
gitignored, and you can change it there at any time.

If you prefer to do it in steps:

```bash
npm install
cp .env.example .env    # then edit it — see the comments in the file
npm run db:migrate
npm run db:seed         # optional: adds clearly-labelled sample data
npm run dev
```

### Production-style local run

```bash
npm run serve           # builds, then serves the optimised build on :3000
```

or separately:

```bash
npm run build
npm start
```

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run bootstrap` | Install dependencies, create `.env` with generated secrets, migrate, seed. |
| `npm run setup` | Just the `.env` + migrate + seed part (never overwrites an existing `.env`). |
| `npm run dev` | Development server with hot reload on `:3000`. |
| `npm run build` | Production build. |
| `npm start` | Serve the production build on `:3000`. |
| `npm run serve` | `build` then `start`, in one command. |
| `npm test` | Unit tests (Vitest). |
| `npm run test:e2e` | End-to-end smoke test (Playwright, real browser, real production build). |
| `npm run test:all` | Typecheck, unit tests, then the smoke test. |
| `npm run verify` | Typecheck, unit tests, then a production build. |
| `npm run typecheck` | TypeScript with no emit. |
| `npm run db:migrate` | Apply any outstanding migrations. |
| `npm run db:seed` | Add the sample data. |
| `npm run db:reset` | Delete all links, hours, events and bookings (keeps your profile). |
| `npm run db:reset -- --sample` | Delete **only** the rows labelled `[Sample]`. |
| `npm run db:reset -- --hard` | Delete the database file itself. |

Before running the E2E test the first time: `npx playwright install chromium`.

---

## How to use it

**Owner side** (behind your passphrase):

| Page | What it is for |
| --- | --- |
| `/admin` | Overview: what is booked, what is coming up, your links. |
| `/admin/calendar` | The one calendar. Add busy blocks, import `.ics`, export `.ics`, delete events. |
| `/admin/links` | Booking links: length, buffers, notice, how far ahead, pause or delete. |
| `/admin/hours` | Weekly working hours, your name, and your timezone. |
| `/admin/data` | Export, import, delete the sample data, delete everything. |

**Visitor side** (no sign-in, no account):

| Page | What it is for |
| --- | --- |
| `/book/<slug>` | Pick a day, pick a time, leave your details, done. |
| `/book/<slug>/confirmed/<ref>` | Confirmation, plus a `.ics` to add to your own calendar. |
| `/cancel/<ref>?token=…` | Cancel, using the one-time link issued at booking time. |

The typical first run: sign in → **Hours & profile** (set your timezone and working hours) →
**Booking links** (create one) → copy the link → send it to someone.

### What a visitor can see

Only free times. Never your event titles, never who else has booked, never your calendar. The
booking page is not listed anywhere — it is reachable only by its address.

---

## Permissions and access

**Files.** zcal reads and writes exactly two paths: `.env` (read only, at startup) and the SQLite
database plus its journal files. It creates the database's parent directory if missing.
`npm run setup` writes `.env` with mode `600` (owner read/write only).

**Network.** The server listens on `localhost:3000` by default. It makes **no outbound requests at
all** unless you set `ZCAL_ICS_FEED_URL` *and* press "Sync from feed" — that is the only network
call the app can make, it goes only to the address you configured, and it only ever reads.

**Accounts.** There is one user and no user table. Access to `/admin` is a passphrase you set in
`.env`. Booking pages are deliberately public — that is what makes them shareable.

**Exposing it beyond your machine.** If you put this on a network, put it behind HTTPS (a reverse
proxy such as Caddy or nginx). The session cookie is `httpOnly` and `SameSite=Lax`, and is marked
`Secure` automatically when it is issued over HTTPS. Set `ZCAL_PUBLIC_BASE_URL` to the address
people will actually use, or the links you copy will point at localhost.

---

## Architecture

Next.js 15 (App Router) + TypeScript + SQLite (`better-sqlite3`). One process, one file, no
background workers, no queue, no cache.

```
src/
  app/
    page.tsx                          the front door (lists nothing)
    login/                            passphrase form
    admin/                            owner pages — the whole /admin tree is gated in layout.tsx
      calendar/  links/  hours/  data/
    book/[slug]/                      the public booking page
      confirmed/[publicId]/           confirmation + .ics download
    cancel/[publicId]/                token-gated cancellation
    api/
      auth/                           login, logout
      availability/[slug]/            PUBLIC: free slots for one link
      bookings/                       PUBLIC: reserve, cancel, download .ics
      admin/                          everything else, owner-only
  lib/
    schema.ts        the data model and its migrations, as plain SQL
    db.ts            opening, migrating, and the per-process handle
    repo.ts          every SQL statement in the app lives here
    availability.ts  the slot engine — pure, no I/O, fully unit tested
    scheduling.ts    composes repo + availability; reserveSlot() is the core write
    time.ts          IANA timezone maths on top of Intl (no date library)
    ics.ts           iCalendar reader and writer (no library)
    backup.ts        JSON export and import
    validation.ts    Zod schemas — nothing untrusted reaches SQL without one
    auth.ts          passphrase check, signed session cookie, cancellation tokens
    api.ts           shared response shapes, the owner guard, rate limiting
    sample-data.ts   the [Sample] seed
  components/        Notice, Field, SubmitButton, CopyButton, nav
```

### The data model

Five tables. `settings` holds exactly one row, because there is exactly one user.

```
settings ─── one row: name, email, timezone, calendar name

event_types ────────┐        a shareable booking link
  slug, title, duration, buffers, notice, horizon, interval, is_active

availability_rules           weekly working hours, in the owner's timezone
  weekday, start_minute, end_minute

calendar_events              THE calendar — every busy interval the app knows
  starts_at, ends_at, source ∈ {local, booking, ics}, busy
        ▲
        │ created and deleted together with
        ▼
bookings ───────────┘        a reserved slot
  public_id, invitee, starts_at, ends_at, status, cancel_token
```

`is_sample` on four of those tables is what makes "delete the demo content" a single transaction.

### How availability is computed

`computeSlots()` in `lib/availability.ts` is a pure function. Given the weekly rules, the busy
intervals, a timezone and a window, it:

1. walks local calendar dates in the owner's timezone;
2. steps through each day's rules by the slot interval, requiring the whole meeting to fit;
3. skips wall-clock times that do not exist (the hour a spring-forward removes);
4. drops anything inside the minimum notice or beyond the booking horizon;
5. drops anything whose meeting **plus its buffers** overlaps a busy interval.

Because slots are generated from local wall-clock rules and converted per day, "09:00 every
weekday" stays at 09:00 across a daylight-saving change rather than drifting to 08:00 or 10:00.

### How a booking is written back

`reserveSlot()` re-derives availability from the database and requires the requested time to be
in it. The browser's idea of what was free is never trusted. If it passes, one transaction writes
both the `calendar_events` row and the `bookings` row — so the calendar can never hold a
reservation with no booking behind it, and a rejected booking never leaves an orphan event.

Cancelling deletes the calendar event and keeps the booking record, so the time frees up and you
still have the history.

---

## Where your data lives

One file:

```
./data/zcal.db          (plus zcal.db-wal and zcal.db-shm while the server runs)
```

Change it with `ZCAL_DATABASE_PATH` in `.env`. Relative paths resolve from the project root.

That file is everything: your profile, your links, your working hours, your calendar and every
booking. There is no other state, no cache directory, and nothing stored outside the project.

The only other file zcal reads is `.env`, and its contents are never written to the database,
never logged, and never included in an export.

---

## Backup and restore

**The simple way** — stop the server, copy the file:

```bash
cp data/zcal.db ~/backups/zcal-$(date +%F).db
```

Stop the server first so SQLite checkpoints its write-ahead log. If you must copy it live, use
`sqlite3 data/zcal.db ".backup ~/backups/zcal.db"`, which is safe under concurrent writes.

**The portable way** — *Data* → **Export everything (JSON)**, or:

```bash
curl -b cookies.txt http://localhost:3000/api/admin/export > zcal-backup.json
```

That JSON is readable, diffable, and documented by the schema in `lib/validation.ts`. Import it
on *Data* with either mode:

- **Merge** — keep what is here; add what is missing. Links that already exist are left alone.
- **Replace** — clear everything first, then import. This is what you want when restoring.

Either way the file is fully validated before a single row is written: if any of it is
unreadable, nothing changes.

**Calendar-only export** — *Data* → **Export calendar (.ics)** gives you a standard iCalendar file
that Google Calendar, Apple Calendar, Outlook and Thunderbird will all open.

**Restoring on a new machine:**

```bash
git clone <your copy> && cd zcal
npm run bootstrap
npm run db:reset            # clear the sample data
# then Data → Import → Replace, with your backup file
```

---

## The optional calendar feed, and what happens without it

zcal has exactly one optional external integration: `ZCAL_ICS_FEED_URL`, a read-only iCalendar
subscription address. Google Calendar calls it *"Secret address in iCal format"*; Apple calls it a
*Public Calendar* link.

**With it configured**, the "Sync from feed" button on `/admin/calendar` pulls those events into
your calendar as busy time. It is manual, one-way and read-only: zcal never polls it on a
schedule, and never writes anything back to the remote calendar. Events are matched on their UID,
so syncing repeatedly updates in place instead of duplicating.

**Without it — the degraded mode — the app is completely usable.** This is the default, and
nothing is disabled or crippled. You keep your calendar by:

- adding busy blocks by hand on `/admin/calendar` (title, date, from, to), and/or
- exporting an `.ics` from whatever calendar you already use and uploading it on the same page.

The only thing you lose is the convenience of a one-click pull. The "Sync from feed" button is
visibly disabled and says why, rather than pretending an integration exists.

That feed URL is a credential. It is stored only in `.env`, and is never returned by the API,
written to the database, included in an export, or printed to the log — error messages report the
HTTP status, never the address.

---

## Sample data

`npm run db:seed` (and `npm run bootstrap`) add realistic demo content: two booking links, a
working week, six calendar events and two bookings made through the real availability engine.

It is all clearly marked. Every title starts with `[Sample]`, every row carries `is_sample = 1`,
every invitee address ends in `@example.invalid` (a reserved TLD that cannot resolve), and the
owner overview shows a banner while any of it remains.

Deleting it is one click on *Data*, or:

```bash
npm run db:reset -- --sample
```

Nothing depends on it. An app with the sample data deleted behaves identically.

---

## Testing

```bash
npm test          # 108 unit tests
npm run test:e2e  # one end-to-end smoke test in a real browser
npm run test:all  # typecheck + both
```

**Unit tests** (`tests/unit/`) — every test opens its own in-memory database, so they never touch
`./data`:

| File | Covers |
| --- | --- |
| `time.test.ts` | Timezone conversion, DST gaps and repeats, date parsing. |
| `availability.test.ts` | The slot engine: windows, intervals, buffers, notice, horizon, DST. |
| `data-model.test.ts` | Schema constraints, transactional writes, cascades, sample-data deletion. |
| `booking-workflow.test.ts` | The core loop: publish → reserve → write back → the slot is gone. |
| `ics.test.ts` | iCalendar reading and writing, including a round trip and line folding. |
| `backup.test.ts` | Export/import round trip, merge vs replace, rejecting untrusted files. |
| `auth.test.ts` | Passphrase checking, session-token forgery and expiry, cancellation tokens. |

**End-to-end** (`tests/e2e/core-loop.spec.ts`) — Playwright drives a real Chromium against a real
production build, on its own port and its own throwaway database. It proves the whole loop: the
booking page publishes free time → a visitor reserves a slot → the confirmation and `.ics` are
correct → that time stops being offered → the owner signs in and finds the meeting in their
calendar, marked as having come from a booking. A second test checks that `/admin` is private and
`/book/<slug>` is not.

---

## Security notes

- **Nothing untrusted reaches SQL unvalidated.** Every request body is parsed by a Zod schema
  (`lib/validation.ts`) before use, and every statement is prepared and parameterised.
- **Secrets are never logged.** Configuration problems are reported by variable *name*, never
  value; feed failures report an HTTP status, never the URL. There is a test asserting this.
- **Private file contents are never logged.** Uploaded `.ics` and backup files are parsed and
  discarded; nothing from them is printed.
- **Constant-time comparison** for the passphrase, the session signature and cancellation tokens.
- **Signed, expiring session cookie** — `httpOnly`, `SameSite=Lax`, `Secure` over HTTPS, 30 days,
  HMAC-SHA256. Changing `ZCAL_SESSION_SECRET` invalidates every session.
- **Login is rate limited** to 10 attempts per 5 minutes per client, and booking to 20 per 10
  minutes, to slow down guessing and accidental hammering.
- **Request bodies are capped** at 8 MB, and calendar files at 5 MB.
- **Cancellation tokens are excluded from exports** — they are per-invitee secrets. Imported
  bookings get fresh ones.
- **`robots` is set to `noindex`** and the app sends `X-Frame-Options`, `X-Content-Type-Options`
  and a same-origin `Referrer-Policy`.

This is a personal tool designed for a machine you control. It has not been audited, and it makes
no compliance claims of any kind.

---

## Limitations

These are real and deliberate. Read them before trusting this with something that matters.

**Excluded on purpose.** These are the things a paid product does that this does not:

- **No multi-calendar conflict handling.** There is exactly *one* calendar. If your real life is
  spread across a work calendar and a personal one, zcal will not reconcile them — import both
  into the one calendar, or accept that it only knows about what it can see.
- **Booking is not race-free under load.** `reserveSlot()` checks availability and then writes;
  those two steps are not serialised against other in-flight requests. A unique index stops two
  confirmed bookings on the *same link at the same start time*, and that is the case you will
  actually hit. It does **not** stop two bookings on *different* links overlapping each other, or
  a booking that violates a buffer, if both requests land in the same instant. For one person
  sharing a link with one person at a time, this is fine. For a booking page under real
  concurrent traffic, it is not.
- **No team routing, no round robin, no shared availability.** One person, one calendar.

**Other things it does not do:**

- **No email.** zcal has no mail account and no third-party sender. Nothing is sent, ever. The
  invitee gets an on-screen confirmation and a downloadable `.ics`; the owner sees the booking in
  the app. If you want an email, send one yourself. The confirmation page says this plainly rather
  than implying a message is on its way.
- **No meeting links.** It does not create Zoom, Meet or Teams links. The "Where" field on a
  booking link is free text you write yourself.
- **No recurring events on import.** An `.ics` event with an `RRULE` is skipped, and the import
  tells you which ones and why, rather than importing only the first occurrence and quietly
  getting your availability wrong.
- **No timezone conversion for visitors.** Times are displayed in the owner's timezone, labelled
  clearly, with a warning when the visitor's device is set to a different zone. It does not
  convert times into the visitor's zone.
- **No reminders, no reschedule flow, no waiting list, no payments.** Cancel and rebook.
- **Rate limiting is per process and in memory.** It resets when the server restarts and does not
  work across multiple instances. There is only meant to be one instance.
- **SQLite means one writer.** Fine for one person. Not a horizontally scalable database.
- **Deleting a booking link** removes its booking records but leaves meetings already in your
  calendar, so committed time never silently frees itself.

---

## Licence

Do what you like with it. No warranty.
