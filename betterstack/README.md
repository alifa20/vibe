# uptime

A small, self-hosted uptime and cron monitor, inspired by Better Stack and
Cronitor. It checks your HTTP endpoints on a schedule, listens for pings from
your cron jobs, warns you before TLS certificates expire, and sends you an email
when something goes down and again when it comes back.

Node + Express + better-sqlite3. Server-rendered HTML with no frontend framework
and no build step. One SQLite file holds every monitor, check, ping and
incident. Nothing on any page loads from another origin, and a
Content-Security-Policy header enforces that.

- **HTTP monitors.** Each has a URL, an interval, a timeout and the status codes
  that count as healthy. A monitor goes down only after a set number of failures
  in a row, and comes back up after a set number of successes. You get one email
  per change, never one per check.
- **Heartbeats.** These cover cron jobs, backups and anything else that should
  run on a schedule. The job calls a secret URL when it finishes. If no call
  arrives on time (a fixed period, or a cron expression in a timezone you
  choose) plus a grace period, you get an email.
- **TLS expiry warnings.** HTTPS monitors also read the server's certificate.
  You get one email each at 14, 7 and 1 days before it expires.
- **Dashboard.** It shows every monitor's state, last check, 24-hour uptime and a
  latency sparkline, plus heartbeats and recent incidents.

---

## Quick start

```sh
pnpm install
cp .env.example .env
# set ADMIN_PASSWORD at minimum (12+ characters)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

pnpm start  # http://127.0.0.1:3000
pnpm dev    # same, with --watch
pnpm test   # node:test suite, no network or real waiting needed
```

Needs Node 22 or newer. On first run the app creates `data/uptime.db` and its
tables. There is no migration step. If better-sqlite3 has no prebuilt binary
for your Node version, `pnpm install` compiles it, which needs a C++ toolchain
(Xcode command line tools on macOS, `build-essential` on Debian/Ubuntu).

With `SMTP_HOST` unset everything still works. Alerts are written to the
console instead of being emailed.

---

## Configuration

All settings live in `.env` (gitignored). `.env.example` is the annotated copy.

| Variable | Default | Description |
| --- | --- | --- |
| `ADMIN_PASSWORD` | (required) | The one admin password, at least 12 characters. It also signs the session cookie, so changing it signs everyone out. |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback when a proxy on the same host sits in front. |
| `TRUST_PROXY` | unset | Set to `1` behind one reverse proxy. Without it, `X-Forwarded-*` headers are ignored. It decides which IP the login lockout counts and whether the cookie gets `Secure`. |
| `DB_PATH` | `./data/uptime.db` | SQLite file. |
| `BASE_URL` | unset | Public origin, no trailing slash. Used for links in alert emails and for the ping URLs shown on heartbeat pages. If unset, ping URLs use the host you're browsing from. |
| `SMTP_HOST` | unset | SMTP server. Leave it empty to log alerts instead of emailing them. |
| `SMTP_PORT` | `587` | Usually `587` (STARTTLS) or `465` (implicit TLS). |
| `SMTP_SECURE` | unset | `1` for implicit TLS on port 465. |
| `SMTP_USER` / `SMTP_PASS` | unset | Credentials. Leave both empty for an unauthenticated relay. |
| `SMTP_FROM` | unset | Envelope From, e.g. `Uptime <uptime@example.com>`. |
| `ALERT_EMAIL_TO` | unset | Who receives the down, recovery and certificate emails. |

---

## Using it

### HTTP monitors

Choose **New monitor** and fill in:

- **URL**: any `http://` or `https://` address. Redirects are followed, and the
  final status code is what gets compared.
- **Check every**: 30 seconds to 24 hours.
- **Timeout**: 1 to 60 seconds, and always shorter than the interval, so a slow
  check can never overlap the next one.
- **Expected status codes**: a range or a list, such as `200-299` or `200,301`.
- **Failures before down** / **Successes before up**: these stop a flapping
  endpoint from flooding your inbox. With 2 failures before down, a single
  failure followed by a success sends nothing.

Example monitors for the other apps in this repo, if you run them on one box:

| Name | URL | Expected |
| --- | --- | --- |
| forms (tally) | `http://127.0.0.1:3000/admin` | `200-399` |
| qrforge | `http://127.0.0.1:3001/healthz` | `200` |
| senja | `http://127.0.0.1:3002/` | `200-299` |
| linkinbio | `http://127.0.0.1:8787/` | `200` |
| golinks (deployed) | `https://go.example.com/admin` | `200-299` |
| this monitor's own public URL | `https://uptime.example.com/healthz` | `200` |

Use whatever ports you actually gave each app. `/healthz` answers `ok` without a
login, which makes it a good target for watching this app from another monitor.

### Heartbeats

Choose **New heartbeat**. Pick either a fixed period (e.g. every 60 minutes)
or a cron expression with an IANA timezone, plus a grace period. The detail
page shows three secret URLs:

| URL | Meaning |
| --- | --- |
| `/ping/<token>` | The job finished. |
| `/ping/<token>/start` | The job started. The next success ping records how long it ran. |
| `/ping/<token>/fail` | The job failed. Alerts at once. |

All three accept GET or POST and need no login. They answer `200 OK` or
`404 Not found` and reveal nothing else. Tokens are random UUIDs, so treat each
URL like a password.

A crontab line for a nightly backup at 03:00, with a fail ping if the script
exits non-zero:

```cron
0 3 * * * /usr/local/bin/backup.sh && curl -fsS -m 10 --retry 3 https://uptime.example.com/ping/<token> >/dev/null || curl -fsS -m 10 --retry 3 https://uptime.example.com/ping/<token>/fail >/dev/null
```

Pair it with a heartbeat on cron `0 3 * * *` in your server's timezone and,
say, a 30-minute grace period. If 03:00 passes with no ping, the heartbeat
shows as **late**. If 03:30 passes too, it goes **down** and you get one email.
The next ping brings it back up and sends a recovery email with the length of
the outage. Due times come from the cron expression in the heartbeat's own
timezone, so daylight-saving changes do not shift them.

A new heartbeat waits for its first ping before it can go late.

---

## How it works

- **One timer per monitor.** Each monitor's state, failure and success counts,
  and next check time are saved in SQLite after every check. After a restart,
  monitors pick up where they left off. Overdue ones are spread over the next
  minute rather than all firing at once. A global cap limits how many checks
  run at the same time. Each check gets a small random jitter.
- **States.** A monitor moves from pending to up on its first success. It moves
  from pending or up to down after N consecutive failures, which opens an
  incident and sends the down email with the error. It moves from down back to
  up after M consecutive successes, which closes the incident and sends the
  recovery email with the outage length, counted from the first failed check.
- **Heartbeats** go from new to up on the first ping, up to late at the expected
  time, and late to down when the grace period ends. A fail ping sends a
  heartbeat straight to down. A sweep every 10 seconds applies these changes.
  After a restart, a heartbeat whose deadline passed while the app was off gets
  one fresh grace period before it can go down.
- **TLS** is read with `tls.connect` at most every 6 hours per HTTPS monitor.
  Connection errors show as a "TLS error" state on the monitor and never as an
  expiry warning. A renewed certificate resets the warnings.
- **Email** goes through one cached nodemailer transport. Sending never throws:
  a broken SMTP server is logged and checks carry on. There is no retry queue,
  so an alert that fails to send is not resent. The dashboard still shows the
  state change.
- **History.** The app keeps the last 3,000 checks per monitor (24 hours at a
  30-second interval) and the last 200 pings per heartbeat. Incidents are kept
  until you delete the monitor or heartbeat.

---

## Deploying

Run it on a box that is not the one you are monitoring. A monitor that shares a
machine with its targets goes down with them and can't tell you.

Behind Caddy on the same host:

```caddy
uptime.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
```

Set `TRUST_PROXY=1` and `BASE_URL=https://uptime.example.com` in `.env`.

A systemd unit:

```ini
[Unit]
Description=uptime monitor
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/vibe/betterstack
ExecStart=/usr/bin/node server.mjs
EnvironmentFile=/opt/vibe/betterstack/.env
Restart=always
User=uptime
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/vibe/betterstack/data

[Install]
WantedBy=multi-user.target
```

Back up `data/uptime.db` with `sqlite3 data/uptime.db ".backup '/var/backups/uptime.db'"`.
It is safe to run while the app is up.

---

## Security notes

- **Admin login**: one password, compared with SHA-256 and `timingSafeEqual`.
  A successful login sets an HMAC-signed, httpOnly, `SameSite=Strict` cookie
  that expires after 12 hours. Five wrong passwords from one IP lock that IP
  out for 15 minutes.
- **Cross-site writes**: every POST must come from the same origin
  (`Sec-Fetch-Site` or `Origin`), so a cookie riding along on another site's
  form can't change anything.
- **Ping URLs** are public on purpose. The random UUID token is the credential.
  An unknown token gets the same 404 as a malformed one.
- **Content Security Policy**: `default-src 'none'`, styles only from this
  origin, no scripts at all. The latency sparkline is SVG drawn with
  attributes, never `style=""`. Every monitor name, URL, error message and
  heartbeat field is HTML-escaped.
- **Outbound requests**: the monitor fetches whatever URLs the admin enters,
  including addresses on your private network. Only the admin can add
  monitors, so keep the password strong.

---

## Out of scope

- SMS, Slack, webhook and push alerts. Email only.
- Public status pages.
- Checks from several locations, and detecting that the monitor's own network
  is down. When every monitor fails at once, each down email is still sent.
- User accounts, teams and roles. One admin password.
- A retry queue for alert emails.
- Keyword or JSON assertions on response bodies, and non-HTTP checks such as
  TCP, ping or DNS.
