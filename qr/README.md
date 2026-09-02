# QRForge

A self-hosted QR code generator with dynamic, editable codes and scan tracking.
One Node process, one SQLite file, no accounts, no third-party calls.

- **Generator** (`/`) — type a URL or text, watch the code update live, tune colours,
  dot and corner styles, quiet zone and error correction, drop in a centre logo,
  and export PNG (up to 4096 px) or SVG.
- **Dynamic codes** (`/r/:slug`) — 302-redirect to a target stored in SQLite. Change
  the destination whenever you like; the printed code never changes.
- **Admin** (`/admin`) — HTTP basic auth. Create, edit, disable and delete codes;
  see total scans, the last 30 days, a per-day chart and the most recent hits.

Everything the browser loads is served by this app: the `qr-code-styling` library comes
straight out of `node_modules`, fonts are the system stack, and uploaded logos are read
with `FileReader` and never leave the page.

## Requirements

Node 22 or newer (`better-sqlite3` v13 requires it). That library ships prebuilt binaries
for common platforms; if none matches yours it compiles on install, which needs `python3`,
`make` and a C++ toolchain.

## Run it locally

```bash
npm install
cp .env.example .env      # then set ADMIN_USER / ADMIN_PASS
npm start                 # http://localhost:3000
```

`npm run dev` restarts on file changes.

## Configuration

All settings come from `.env` (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `ADMIN_USER`, `ADMIN_PASS` | Basic-auth credentials for `/admin`. **Required** — the server refuses to start without them. |
| `PORT`, `HOST` | Listen address. Defaults `3000` / `0.0.0.0`. Bind `127.0.0.1` when a reverse proxy is in front. |
| `BASE_URL` | Public origin, e.g. `https://qr.example.com`. Used when printing short links. Derived from the request if unset. |
| `DB_PATH` | SQLite file. Defaults to `./data/qr.db`. |
| `TRUST_PROXY` | Set behind a reverse proxy so `req.protocol` reflects the original scheme. Use the number of proxy hops, or `true` for one. |

## How dynamic codes work

1. Create a code in `/admin`. It gets a short slug (`/r/k7m2xq`) or one you choose.
2. Generate the QR for `https://your-host/r/<slug>` — the "Design" button on each row
   opens the generator with the link filled in.
3. Print it. Later, edit the target in `/admin` and every existing code follows.

Each `GET /r/:slug` logs a timestamp, user-agent and referer, then answers `302` with
`Cache-Control: no-store` so nothing between you and the scanner caches the old target.
Deactivated codes answer `410 Gone`. Unknown slugs answer `404`.

No IP addresses are stored. If you want them, add a column in `src/db.js` and pass
`req.ip` from `src/routes/redirect.js` — and check your local privacy rules first.

## Deploying to a VPS

Assumes Debian/Ubuntu, a domain pointed at the box, and a reverse proxy terminating TLS.

### 1. Install Node and the app

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

sudo adduser --system --group --home /srv/qrforge qrforge
sudo -u qrforge git clone <your-repo> /srv/qrforge/app
cd /srv/qrforge/app
sudo -u qrforge npm ci --omit=dev
```

### 2. Configure

```bash
sudo -u qrforge cp .env.example .env
sudo -u qrforge openssl rand -base64 24      # use this as ADMIN_PASS
sudo -u qrforge nano .env
sudo chmod 600 .env
```

Set at least:

```ini
ADMIN_USER=you
ADMIN_PASS=<the generated password>
HOST=127.0.0.1
PORT=3000
BASE_URL=https://qr.example.com
DB_PATH=/srv/qrforge/data/qr.db
TRUST_PROXY=1
```

```bash
sudo mkdir -p /srv/qrforge/data && sudo chown qrforge:qrforge /srv/qrforge/data
```

### 3. systemd unit

`/etc/systemd/system/qrforge.service`:

```ini
[Unit]
Description=QRForge
After=network.target

[Service]
Type=simple
User=qrforge
Group=qrforge
WorkingDirectory=/srv/qrforge/app
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/qrforge/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now qrforge
sudo systemctl status qrforge
journalctl -u qrforge -f
```

### 4. Reverse proxy

**Caddy** (`/etc/caddy/Caddyfile`) — TLS is automatic:

```
qr.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
```

**nginx** (`/etc/nginx/sites-available/qrforge`):

```nginx
server {
    server_name qr.example.com;
    listen 80;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/qrforge /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d qr.example.com
```

Keep `TRUST_PROXY=1` set so the app builds `https://` short links behind the proxy.
`/admin` is protected by basic auth, which only stays private over TLS — do not expose
this app on plain HTTP.

### 5. Backups

The whole app state is one SQLite file. Back it up with the online backup command so a
snapshot is never torn mid-write:

```bash
sudo -u qrforge sqlite3 /srv/qrforge/data/qr.db ".backup '/srv/qrforge/data/backup-$(date +%F).db'"
```

A daily cron entry plus offsite copy is plenty:

```cron
15 4 * * * sqlite3 /srv/qrforge/data/qr.db ".backup '/srv/qrforge/data/backup.db'"
```

Restoring is a file copy — stop the service, replace `qr.db`, start it again. Note that
WAL mode leaves `qr.db-wal` and `qr.db-shm` beside the database; `.backup` folds them in,
a plain `cp` of just `qr.db` may not.

### 6. Updating

```bash
cd /srv/qrforge/app
sudo -u qrforge git pull
sudo -u qrforge npm ci --omit=dev
sudo systemctl restart qrforge
```

The schema is created with `CREATE TABLE IF NOT EXISTS` on boot, so an update never
needs a migration step for existing data.

## Layout

```
src/
  server.js          express app, security headers, static assets, wiring
  db.js              SQLite schema, prepared statements, slug + URL validation
  auth.js            basic auth + same-origin guard for state-changing requests
  routes/
    redirect.js      GET /r/:slug — logs the scan, 302s to the target
    admin.js         CRUD behind basic auth
  views/
    layout.js        auto-escaping html`` template tag and page shell
    admin.js         admin list, code detail, error pages
public/
  index.html         generator
  app.js             live preview, styling controls, PNG/SVG export
  admin.js           confirm dialogs, local-time timestamps
  styles.css         shared styling, light + dark, mobile layouts
data/qr.db           created on first run
```

## Notes on security

- `/admin` is behind HTTP basic auth with a constant-time credential comparison.
- Because browsers replay basic-auth credentials automatically, every write also
  requires a same-origin `Origin` / `Sec-Fetch-Site`, which blocks cross-site posts.
- All admin output is escaped through the `html` template tag; targets are re-parsed
  with `URL` and restricted to `http:` / `https:` so a code can never carry a
  `javascript:` payload.
- A strict `Content-Security-Policy` (`default-src 'self'`, no inline scripts or
  styles) ships on every response, along with `nosniff`, `X-Frame-Options: DENY`
  and `frame-ancestors 'none'`.
- Slugs that would shadow app routes (`admin`, `api`, `r`, …) are rejected.

## Licence

MIT.
