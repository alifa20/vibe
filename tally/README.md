# Forms

A small, self-hosted form builder — the parts of Tally I actually use, on my own
box, with respondent data in a SQLite file I control.

Node + Express + better-sqlite3. Server-rendered HTML, no frontend framework, no
build step, no third-party form service, no telemetry. Nothing on any page loads
from another origin, and a Content-Security-Policy header enforces that.

- **`/admin`** — create forms, add and reorder fields, read responses, export CSV.
  One shared `ADMIN_TOKEN`, no user accounts.
- **`/f/<slug>`** — the public form. Single column, one accent colour per form,
  validated on the client and again on the server.

---

## Quick start

```sh
npm install
cp .env.example .env
# set ADMIN_TOKEN and BASE_URL, at minimum
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm start          # http://127.0.0.1:3000/admin
npm run dev        # same, with --watch
```

The app creates `data/` and `uploads/` on first run and applies its schema
automatically. There is no migration step.

---

## Environment variables

All of these live in `.env` (gitignored). `.env.example` is the annotated copy.

### Required

| Variable | Description |
| --- | --- |
| `ADMIN_TOKEN` | The single secret that unlocks `/admin`. Minimum 16 characters; the app refuses to start without it. It also signs the admin session cookie, so changing it logs you out everywhere. |
| `BASE_URL` | Public origin, no trailing slash — e.g. `https://forms.example.com`. Used for the share links shown in the admin UI and in notification emails. |

### Server

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback when Caddy proxies from the same host. |
| `TRUST_PROXY` | `1` | Number of proxies in front of the app. `1` = Caddy on the same host. Controls which `X-Forwarded-For` entry is trusted as the client IP, which is what the rate limiter keys on. |
| `DB_PATH` | `./data/forms.db` | SQLite file. Absolute or relative to the app directory. |
| `UPLOAD_DIR` | `./uploads` | Where uploaded files are written. |
| `INSECURE_COOKIES` | unset | Set to `1` only if you serve the admin over plain HTTP (e.g. through an SSH tunnel). Otherwise the session cookie keeps its `Secure` flag. |

### Spam controls

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_MAX` | `5` | Submissions allowed per IP per form within the window. |
| `RATE_LIMIT_WINDOW_MINUTES` | `10` | Length of that window. |

### Uploads

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | `10` | Per-file cap. Enforced in the browser and again by the server. |

### Email notifications (optional)

Leave `SMTP_HOST` empty to disable email entirely — forms with "email me each
response" ticked will log a warning and carry on, rather than failing.

| Variable | Default | Description |
| --- | --- | --- |
| `SMTP_HOST` | — | SMTP server. Empty disables email notifications. |
| `SMTP_PORT` | `587` | Usually `587` for STARTTLS or `465` for implicit TLS. |
| `SMTP_SECURE` | unset | `1` for implicit TLS (port 465). Leave empty for STARTTLS. |
| `SMTP_USER` / `SMTP_PASS` | — | Credentials. Omit both for an unauthenticated relay. |
| `SMTP_FROM` | — | Envelope From, e.g. `Forms <forms@example.com>`. Must be an address your server may send as. |
| `NOTIFY_EMAIL_TO` | — | Default recipient. Each form can override it. |

---

## Where things live on disk

Everything is under the app directory unless you point `DB_PATH` or
`UPLOAD_DIR` elsewhere:

```
/opt/forms/                                  # wherever you cloned it
├── data/
│   ├── forms.db                             # every form, field and response
│   ├── forms.db-wal                         # WAL journal
│   └── forms.db-shm
└── uploads/
    └── <form-slug>/
        └── 1735689600000-<uuid>.pdf         # one file per upload
```

- **The database** is a single SQLite file in WAL mode. Responses are stored as
  JSON keyed by field key, so deleting a field from a form does not destroy
  answers already collected under it — the response detail page still shows them,
  labelled "removed field".
- **Uploads** are written under a directory named for the form's slug, with a
  generated filename (timestamp + UUID, original extension kept). The original
  filename is kept in the database and restored on download. Renaming a form's
  slug leaves existing files in the old directory; the database records the full
  stored path per file, so downloads keep working. Deleting a response or a form
  removes its files and tidies away the directory once it is empty.
- **Backups**: stop the app (or use `sqlite3 data/forms.db ".backup ..."` while it
  runs) and copy `data/` and `uploads/` together. They are only meaningful as a
  pair.

```sh
# Nightly backup, both halves at once.
sqlite3 /opt/forms/data/forms.db ".backup '/var/backups/forms-$(date +%F).db'"
tar czf "/var/backups/forms-uploads-$(date +%F).tar.gz" -C /opt/forms uploads
```

---

## Deploying behind Caddy

Run the app on loopback and let Caddy terminate TLS.

```caddy
forms.example.com {
	encode zstd gzip

	# Uploads are capped at 10 MB per file; leave headroom for the rest of the
	# multipart body. Raise both this and MAX_UPLOAD_MB together.
	request_body {
		max_size 12MB
	}

	reverse_proxy 127.0.0.1:3000

	log {
		output file /var/log/caddy/forms.log
	}
}
```

Caddy sets `X-Forwarded-For` and `X-Forwarded-Proto` by default, which is what
`TRUST_PROXY=1` expects. If you put another proxy in front of Caddy, raise
`TRUST_PROXY` to match — otherwise every submission looks like it comes from one
IP and the per-IP rate limit will lock out real people.

A systemd unit to go with it:

```ini
# /etc/systemd/system/forms.service
[Unit]
Description=Forms
After=network.target

[Service]
Type=simple
User=forms
WorkingDirectory=/opt/forms
EnvironmentFile=/opt/forms/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

# The app only ever writes to data/ and uploads/.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/forms/data /opt/forms/uploads

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now forms
sudo systemctl status forms
curl -sf https://forms.example.com/healthz   # -> ok
```

---

## Using it

### Fields

Six types: **short text**, **long text**, **email**, **dropdown**, **checkbox**
(a single box, for consent-style questions) and **file upload**. Each can be
marked required, given help text, and moved up or down with the arrows on the
field list.

Every field has a **key**, derived from its label (`Your name` → `your-name`).
The key is the HTML input name, the CSV column header and the webhook JSON key.
You can edit it, but answers already stored under the old key stop lining up
with the column — so change it before you start collecting, not after.

### Responses

`/admin/forms/<id>/responses` is a sortable table: click any column header to
sort by it, click again to reverse. Empty answers always sort to the bottom.
50 rows per page. **Export CSV** downloads everything (not just the current
page) in the current sort order, with a UTF-8 BOM so Excel opens it correctly.

### Notifications

Per form, both optional, both fire after the response is safely stored:

- **Email** — one message per response via the SMTP credentials in `.env`, with
  a plain-text and an HTML part. Blank recipient falls back to `NOTIFY_EMAIL_TO`.
- **Webhook** — a `POST` with `Content-Type: application/json`, a 10-second
  timeout, and no redirect following:

  ```json
  {
    "form":     { "id": 1, "slug": "project-enquiry", "title": "Project enquiry" },
    "response": { "id": 42, "created_at": "2026-03-04T09:15:22Z", "ip": "203.0.113.7",
                  "user_agent": "Mozilla/5.0 ..." },
    "answers": [
      { "key": "your-name", "label": "Your name", "type": "text",     "value": "Ada Lovelace" },
      { "key": "budget",    "label": "Budget",    "type": "select",   "value": "Over £20,000" },
      { "key": "consent",   "label": "Keep in touch", "type": "checkbox", "value": true },
      { "key": "brief",     "label": "Brief",     "type": "file",
        "value": { "name": "brief.pdf", "size": 184320, "type": "application/pdf",
                   "stored": "project-enquiry/1735689600000-....pdf" } }
    ]
  }
  ```

Neither can fail a submission. A dead SMTP server or a webhook returning 500
gets logged and the respondent still sees the thank-you page.

### Spam handling

Two layers, no third-party service and no CAPTCHA:

1. **Honeypot** — a visually hidden `website_url` input. If anything fills it,
   the submission is dropped and the bot still sees the thank-you page, so it
   has nothing to learn from.
2. **Per-IP rate limit** — `RATE_LIMIT_MAX` submissions per form per
   `RATE_LIMIT_WINDOW_MINUTES`, in memory, keyed on the proxied client IP.
   Rejected submissions return `429` with a `Retry-After` header. Failed
   validation does not count against the limit, so someone fixing a typo is not
   locked out. The window is in memory only and resets on restart — a deliberate
   trade for having no extra moving parts.

---

## Notes

- **Sessions**: the admin cookie is `HttpOnly`, `Secure` and `SameSite=Lax`,
  signed with `ADMIN_TOKEN`. `SameSite=Lax` means another site cannot make your
  browser submit admin forms, so there is no separate CSRF token.
- `/admin?token=<ADMIN_TOKEN>` logs in via URL and redirects to a clean address.
  Handy for a bookmark or `curl`; it does put the token in your history.
- **Closing a form**: untick "Accepting responses" in the form's settings. The
  public page then returns 403 with a short note instead of the form.
- **Timestamps** are stored and displayed in UTC.
- Both `/f/<slug>` and `/admin` send `X-Robots-Tag`-equivalent `noindex` meta
  tags; forms are unlisted, not secret. Anyone with the link can submit.

## Not built, on purpose

Partial submissions, conditional logic, payments, team workspaces, and a
template gallery. This is a personal tool.
