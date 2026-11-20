# analytics

Web analytics I host myself, inspired by Plausible. One script tag on your
site, pageviews in a SQLite file on your server, and a dashboard behind a
password.

Visitors get no cookies and nothing in their browser storage. Unique visitors
are counted from a hash that can only be computed on the day it was made, so
nobody can trace a hash back to an IP address afterwards, including you.

Node + Express + better-sqlite3. Server-rendered HTML with no frontend
framework, no build step and no third-party requests. A Content-Security-Policy
header blocks every inline script and style.

- **`/script.js`**: the tracker, a single readable file you can check before you
  paste it in.
- **`/api/event`**: where the tracker sends pageviews.
- **`/`**: the dashboard. Add a site, copy its snippet, read the numbers.

---

## Quick start

```sh
pnpm install
cp .env.example .env
# set ADMIN_PASSWORD (12+ characters)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

pnpm start  # http://127.0.0.1:8000
pnpm dev    # same, with --watch
pnpm test
```

Sign in, add your site's domain, and paste the snippet the dashboard shows into
the `<head>` of every page:

```html
<script defer data-domain="example.com" src="https://stats.example.com/script.js"></script>
```

The server creates `data/` on first run and applies its schema itself. There is
no migration step.

---

## Configuration

Everything lives in `.env` (gitignored). `.env.example` is the annotated copy.

| Variable | Default | Description |
| --- | --- | --- |
| `ADMIN_PASSWORD` | none, required | The dashboard password, at least 12 characters. It also signs the session cookie, so changing it signs you out everywhere. |
| `PORT` | `8000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback when a proxy on the same host forwards to it. |
| `TRUST_PROXY` | unset | Set to `1` when a reverse proxy is in front. Only then is `X-Forwarded-For` used as the visitor's IP and `CF-IPCountry` read for the country. Unset, both headers are ignored, so nobody can send a fake address. |
| `BASE_URL` | from the request | Public origin used in the snippet, e.g. `https://stats.example.com`. |
| `DB_PATH` | `./data/analytics.db` | The SQLite file. |
| `RETENTION_DAYS` | unset | Delete pageviews older than this many days, checked at start-up and once a day after that. Unset keeps everything. |

### Tracker options

Attributes on the `<script>` tag:

| Attribute | What it does |
| --- | --- |
| `data-domain` | The domain you added in the dashboard. Required. |
| `data-respect-dnt` | Skip visitors whose browser sends Do Not Track. Off by default, because DNT is mostly a dead signal. Global Privacy Control is always honoured. |
| `data-api` | Send to another endpoint, if you proxy `/api/event` through your own site. |

---

## How it works

**The tracker** reads `data-domain`, then sends one small request per page
view with `navigator.sendBeacon` (or `fetch` with `keepalive` where that isn't
available). The body is `text/plain`, so browsers send it without a CORS
preflight. Single-page apps are covered: the script wraps `history.pushState`
and `replaceState` and listens for `popstate`, and counts a new view whenever
the path changes.

**The collector** answers right away and stores nothing when:

- the domain isn't one you added
- the user agent is a known bot, a headless browser, or missing
- there's no `Accept-Language` header (real browsers always send one)
- the browser sends `Sec-GPC: 1`, or `DNT: 1` on a site that opted in
- the request is a `HEAD`

Everything else is reduced before it's stored:

- **Path**: the URL path only. Every query parameter is dropped except
  `utm_source`, `utm_medium` and `utm_campaign`, so an email address or a
  token in a link never lands in the database.
- **Referrer**: the host only (`https://www.google.com/search?q=...` becomes
  `google.com`). Links within your own site are dropped.
- **Browser, OS, device**: read from the user agent with a short regex table,
  then the user agent itself is thrown away.
- **Visitor**: `SHA-256(salt + site + IP + user agent)`, cut to 64 bits.

**The salt** is 32 random bytes, made fresh for each UTC day. It's kept in
memory and in one database row, so a mid-day restart keeps counting the same
visitors. At UTC midnight a new salt replaces it and the old one is deleted.
After that, a stored hash can't be matched to anyone, because the input that
produced it no longer exists. The cost is that one person visiting on two days
counts as two visitors.

**Writes** go to an in-memory queue that's written to SQLite once a second, in
one transaction. The queue is flushed again on shutdown (`SIGINT`/`SIGTERM`).

**The dashboard** reads the raw `events` table and adds things up when you
load the page. For any range of days you get:

- pageviews and unique visitors as a chart, with empty days shown as zero
- top pages and referrer hosts
- UTM sources and campaigns
- browsers, operating systems and device types

Visitor totals over more than one day are a **sum of daily uniques**, and the
dashboard says so next to the number. All days are UTC days.

---

## Deploying

Run it on loopback behind a proxy that terminates TLS. With Caddy:

```caddy
stats.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8000
}
```

Then set `TRUST_PROXY=1` and `BASE_URL=https://stats.example.com`. Caddy sets
`X-Forwarded-For` and `X-Forwarded-Proto`, which is what the app reads. Behind
Cloudflare, `CF-IPCountry` fills in the country column.

A systemd unit:

```ini
# /etc/systemd/system/analytics.service
[Unit]
Description=analytics
After=network.target

[Service]
Type=simple
User=analytics
WorkingDirectory=/opt/analytics
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/analytics/data

[Install]
WantedBy=multi-user.target
```

The server loads `.env` from its working directory. To back up while it runs:

```sh
sqlite3 /opt/analytics/data/analytics.db ".backup '/var/backups/analytics-$(date +%F).db'"
```

---

## Security notes

- **Sessions**: signing in sets an `HttpOnly`, `SameSite=Strict` cookie that
  expires after 12 hours. It's HMAC-signed with `ADMIN_PASSWORD`, and marked
  `Secure` when the request came over HTTPS.
- **Sign-in attempts**: five wrong passwords from one IP lock that IP out for 15
  minutes, even if the right password comes next. The counter lives in memory
  and resets on restart.
- **Cross-site requests**: every dashboard `POST` must come from the dashboard's
  own origin (checked with `Sec-Fetch-Site` and `Origin`).
- **Collected text** (paths, referrers, UTM values) is escaped before it's
  rendered. A path like `/<script>` shows up as text.
- **Headers**: every response sends a Content-Security-Policy with no inline
  script or style, `X-Content-Type-Options: nosniff`, and a `Referrer-Policy`.
  The collect endpoint allows any origin, never with credentials.
- **What's in the database**: no IP addresses, no user agents, no full URLs.
  The visitor hash means nothing once its day's salt has been deleted.

## Out of scope

Custom events and goals, funnels, email reports, several users or teams,
public dashboards, importing from other tools, and a GeoIP database (country
comes only from `CF-IPCountry` behind a trusted proxy). There are no rollup
tables yet; queries run on raw events, which is fine for a personal site's
traffic.
