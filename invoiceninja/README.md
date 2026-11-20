# invoices

A small, self-hosted invoicing app for one business: keep your clients, write
invoices from line items, mark them sent and paid, and print them to PDF from
the browser. Inspired by Invoice Ninja, trimmed down to what a freelancer or a
one-person studio uses every week.

Node + Express 5 + better-sqlite3. Server-rendered HTML, no frontend framework,
no build step, no PDF library. Everything lives in one SQLite file you control,
and a strict Content-Security-Policy keeps every page free of inline styles,
inline scripts and anything from another origin.

- **Exact money.** Amounts are stored as whole cents (or yen, or fils), never
  as floats. Tax is worked out once per rate per invoice.
- **Gap-free numbers.** `INV-2026-0001`, `INV-2026-0002`, … assigned when you
  mark an invoice sent, one sequence per year.
- **Frozen once sent.** The database itself refuses edits to a sent invoice.
- **Prints cleanly** on A4 or Letter.

---

## Quick start

```sh
pnpm install
cp .env.example .env
# set ADMIN_PASSWORD (12+ characters)
pnpm start
```

Open <http://127.0.0.1:3000>, sign in, then:

1. **Settings**: your business name, address, tax ID, payment details, default
   currency, payment terms, paper size and timezone.
2. **Clients**: add the people you bill.
3. **New invoice**: pick a client and currency, add lines, then **Mark sent**.
4. **Print / PDF** on the invoice, and **Record payment** when the money lands.

Needs Node 22.9 or newer (the start script uses `--env-file-if-exists`).
`better-sqlite3` is a native module. If no prebuilt binary matches your Node
version, pnpm compiles it, which needs a C++ toolchain (Xcode command line
tools on macOS, `build-essential` and `python3` on Debian or Ubuntu).

`pnpm test` runs the test suite with `node --test`. It uses in-memory SQLite
and a fake clock, so it needs no setup.

## Configuration

All settings come from environment variables. `.env.example` documents each one.

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_PASSWORD` | required | The admin password. At least 12 characters; the server refuses to start without one or with a `change-me...` placeholder. Changing it signs everyone out. |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Bind address. The default keeps the app private to the machine. |
| `TRUST_PROXY` | empty | Number of reverse proxies in front. Leave empty when there are none, so `X-Forwarded-*` headers are ignored. |
| `DB_PATH` | `./data/invoices.db` | SQLite file. Created on first start. |
| `SECURE_COOKIES` | empty | `1` forces the `Secure` flag on the session cookie. |

Business details, paper size, default currency, payment terms and timezone are
set in the app under **Settings**, not in the environment. The timezone starts
as the server's own.

## How it works

### Money

Every amount is an integer in the currency's smallest unit. How many decimals a
currency has comes from `Intl.NumberFormat`, so USD has 2, JPY has 0 and KWD
has 3. Quantities are stored ×1000 (so `1.5` hours is `1500`) and tax rates in
basis points (`7.25%` is `725`). Input is parsed from the decimal string
directly, never through a float, and products go through `BigInt`.

Each line's amount is quantity × unit price. Lines are then grouped by tax rate,
and the tax for each rate is computed once on that group's net and rounded half
away from zero. That is why the invoice shows one tax row per rate. Three lines of
0.05 at 10% come to 0.02 of tax (10% of 0.15, rounded), where rounding each
line separately would give 0.03.

Each invoice has one currency. The dashboard keeps a separate total per
currency and never converts between them.

### Lifecycle

```
draft ──mark sent──▶ sent ──record payment──▶ paid
                       │                        │
                       └────────▶ void ◀────────┘
```

- **Draft**: no number yet. Lines, client, currency and notes can change, and
  the draft can be deleted.
- **Sent**: the app takes the next number for the current year, sets today as
  the issue date, fills in the due date (the one you chose, or today plus your
  payment terms), copies your business details and the client's details onto
  the invoice, and stores the totals. From here on the invoice is frozen.
- **Paid**: full payment only, with a date and an optional method.
- **Void**: permanent. The invoice keeps its number so the sequence stays
  unbroken. To fix a mistake on a sent invoice, void it and write a new one.

**Overdue** is not a stored state. An invoice shows as overdue when it is sent,
unpaid, and today is after its due date. On the due date itself it is still
just sent.

Each of mark sent, record payment, void and delete goes through its own
confirmation page that says what will happen.

### Numbering

Numbers come from a `counters` table with one row per year. The send happens
inside a single `BEGIN IMMEDIATE` transaction: take the next number, write the
invoice, commit. Two sends at the same moment queue behind each other, and a send
that fails rolls the counter back too, so numbers are never skipped or reused.
The test suite checks this with two connections sending from two threads
against a real database file.

"Today" and "this year" use the timezone from Settings. With
`Australia/Melbourne`, an invoice sent at 08:00 on 1 January is numbered in the
new year even though it is still 31 December in UTC.

### Enforced by the database

SQLite triggers back up the rules, so a bug in a route or a stray SQL statement
cannot break them:

- once an invoice leaves draft, its number, dates, currency, totals, notes and
  both sets of copied details cannot change, and its lines cannot be added,
  edited or removed;
- status only moves draft→sent, sent→paid, sent→void or paid→void;
- only drafts can be deleted;
- a void invoice cannot change at all.

Editing a client or your business details later never changes an invoice that
has already gone out.

Schema changes are versioned in a `schema_migrations` table and applied in
order at startup.

### Printing

**Print / PDF** opens a clean page that uses only print styles, no PDF
library. Use the browser's print dialog and choose *Save as PDF*. Turn off the
dialog's *Headers and footers* option, or the browser adds its own URL and date
to every page. The page says this too.

The paper size (A4 or Letter) comes from Settings. Table headers repeat on each
page of a long invoice, and rows never split across a page break. Drafts print
with a DRAFT stamp and no number, so a draft is never mistaken for the real
thing.

## Where things live on disk

Everything is in the SQLite file at `DB_PATH` (default `data/invoices.db`),
plus its `-wal` and `-shm` companions while the app runs. To back it up while
the app is running, use SQLite's online backup:

```sh
sqlite3 data/invoices.db ".backup 'backup/invoices-$(date +%F).db'"
```

## Deploying

The app is a plain Node process. Run it under systemd (or any process manager)
and put a TLS-terminating reverse proxy in front. With Caddy:

```
invoices.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then set `TRUST_PROXY=1` so the app sees the real client IP and knows the
request arrived over HTTPS (which adds the `Secure` flag to the cookie). Keep
`HOST=127.0.0.1` so only the proxy can reach the app.

A minimal systemd unit:

```ini
[Unit]
Description=invoices
After=network.target

[Service]
WorkingDirectory=/srv/invoices
ExecStart=/usr/bin/node --env-file=.env server.mjs
Restart=on-failure
User=invoices

[Install]
WantedBy=multi-user.target
```

The app only writes to the folder holding `DB_PATH`.

## Security notes

- **One admin.** `ADMIN_PASSWORD` is checked by hashing both sides with SHA-256
  and comparing with `timingSafeEqual`, so the comparison does not leak length
  or content through timing.
- **Sessions** are a cookie holding an expiry time and an HMAC of it, keyed by
  the password. It is `HttpOnly` and `SameSite=Lax`, lasts 12 hours, and
  changing the password ends every session.
- **Login lockout.** After 8 failed attempts from one IP, that IP is locked out
  for 15 minutes. Set `TRUST_PROXY` correctly behind a proxy, or every client
  shares the proxy's IP.
- **Cross-site requests.** Every POST is refused when the browser marks it as
  cross-site (`Sec-Fetch-Site`) or its `Origin` does not match the host, on top
  of `SameSite=Lax`.
- **Escaping.** Client names, addresses, line descriptions and notes are
  HTML-escaped wherever they appear.
- **CSP.** `default-src 'self'; style-src 'self'; script-src 'self'` with no
  `unsafe-inline`. Pages have no `style=""` attributes and no inline scripts.
  The only script is the print button.
- Pages send `noindex` and `Cache-Control: no-store`.

## Not built, on purpose

Emailing invoices to clients, online payments, partial payments, recurring
invoices, credit notes, quotes, expenses, currency conversion, and more than one
user or business. This is a tool for one person sending a handful of invoices a
month.
