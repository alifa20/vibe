# link-in-bio

A self-hosted replacement for Linktree. One page, one JSON file, first-party
click tracking, and a stats page behind basic auth.

**No dependencies.** Not "few" — the `package.json` has no `dependencies` block
at all. It runs on the Node standard library. There is nothing to `npm install`,
nothing to audit, and no third-party script on the public page.

```
links.json        the CMS — edit this file, the page updates on the next request
server.mjs        http server: /, /go/:slug, /stats, static files
src/config.mjs    .env loader, links.json parsing, slug assignment
src/render.mjs    the page, design tokens, embedded CSS
src/stats.mjs     click-log reader and the /stats page
src/og.mjs        the 1200x630 social card
scripts/build.mjs generates og.png, the icons and the static dist/ copy
public/           avatar, favicon, og.png, robots.txt — served as-is
data/clicks.log   one tab-separated line per click
deploy/           Caddyfile, nginx.conf, systemd unit, logrotate config
```

## Quick start

```bash
cp .env.example .env      # then set STATS_USER, STATS_PASS and HASH_SALT
npm run build             # generates og.png, favicon, avatar placeholder
npm start                 # http://127.0.0.1:8787
```

Node 20.6 or newer. `npm run dev` restarts on file changes.

## Editing links

`links.json` is the whole content model.

```json
{
  "name": "Ali Fathieh",
  "bio": "One or two sentences.",
  "avatar": "/avatar.svg",
  "siteUrl": "https://links.example.com",
  "links": [
    { "title": "Writing", "url": "https://yourdomain.com/writing", "emoji": "✍️" }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Shown on the row. Long titles ellipsize rather than wrap. |
| `url` | yes | `http`, `https` or `mailto`. The host is displayed in the right margin. |
| `emoji` | no | Falls back to the first letter of the title. |
| `slug` | no | Pins the tracking key. Defaults to a slug of the title. |
| `hidden` | no | `true` takes the link off the page without deleting its click history. |

Save the file and reload — the server notices the new mtime and re-renders. No
build, no restart. If you break the JSON, the server keeps serving the last good
version and prints the parse error to the log.

**Rename a title, keep the stats.** Clicks are keyed by slug, so renaming
`"GitHub"` to `"Code"` starts a new bucket. To keep the history, pin the slug
before you rename:

```json
{ "title": "Code", "slug": "github", "url": "https://github.com/yourhandle" }
```

Run `npm run build` after changing the name, bio, avatar or link list — those
appear in the social card, which is a real PNG and has to be regenerated.

## Click tracking

Every row links to `/go/<slug>`. The server appends one line to
`data/clicks.log` and answers `302` to the real URL with `Cache-Control:
no-store`, so browsers never cache the redirect and skip the count.

```
2026-09-01T09:31:02.114Z	writing	human	news.ycombinator.com	fba6c6e34b16	Mozilla/5.0 …
└ ISO timestamp          └ slug  └ kind  └ referrer            └ visitor   └ user agent
```

Tab-separated on purpose, so the log answers questions without the stats page:

```bash
cut -f2 data/clicks.log | sort | uniq -c | sort -rn        # clicks per link
grep -P '\thuman\t' data/clicks.log | wc -l                # humans only
cut -f1 data/clicks.log | cut -c1-10 | uniq -c             # clicks per day
cut -f4 data/clicks.log | sort | uniq -c | sort -rn        # top referrers
```

**Campaign tags.** `?ref=` overrides the referrer column, so the same link can be
tracked per placement: `https://links.example.com/go/writing?ref=qr-card` logs
`tag:qr-card`. Useful for print, QR codes and conference badges.

**Bots.** Link previewers (Slack, iMessage, Bluesky, search crawlers) fetch every
URL you post. They are classified by user agent, logged as `bot`, and excluded
from `/stats` by default — the toggle in the top right includes them. Any `HEAD`
request counts as a bot regardless of user agent, because nobody taps a link with
`HEAD`.

**Visitors.** The fifth column is `sha256(salt + date + IP)`, truncated. It makes
"unique visitors per day" countable without ever writing an IP to disk, and the
value changes daily so it cannot be used to follow someone across days. Set
`HASH_SALT` in `.env` or a random one is generated at each boot and the counts
reset with every restart.

Nothing is sent anywhere. No analytics script, no pixel, no cookie, no
`localStorage`. The page loads exactly two subresources, both from your own
domain: the avatar and the favicon.

## /stats

Basic auth from `.env`:

```ini
STATS_USER=admin
STATS_PASS=a-long-random-string
```

Credentials are compared in constant time, and eight failures from one IP lock
that IP out for fifteen minutes. If either variable is unset, `/stats` returns
`503` rather than opening up.

Time range is `?days=` (`1`, `7`, `30`, `90`, `0` for all time), bots are
`?bots=1`. The page is server-rendered and ships no JavaScript.

Basic auth is only private over HTTPS. Both reverse-proxy configs in `deploy/`
force TLS.

## The social card

`npm run build` renders `src/og.mjs` at 1200×630 with headless Chrome and writes
`public/og.png`. Any Chrome, Chromium or Edge binary works; set `CHROME_PATH` if
it lives somewhere unusual.

The server has no such dependency — it only serves the PNG. If your VPS has no
browser, run `npm run build` on your laptop and copy `public/og.png` up with the
rest of the project.

The `<meta property="og:image">` URL carries a `?v=` content hash, so Slack,
Bluesky and X refetch the card when the content changes instead of showing a
stale one.

Check what a scraper sees:

```bash
curl -s https://links.example.com/ | grep -E 'og:|twitter:'
```

---

# Deploying to a VPS

A 512 MB box is more than enough. These steps assume Debian or Ubuntu; the
`linkinbio` user has no shell and no sudo.

## 1. Install Node and create the service user

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo useradd --system --home /srv/linkinbio --shell /usr/sbin/nologin linkinbio
sudo mkdir -p /srv/linkinbio
```

## 2. Copy the project up

```bash
# from your laptop, in the project directory
rsync -av --exclude node_modules --exclude .env --exclude data --exclude .git \
  ./ root@your-server:/srv/linkinbio/
```

`public/og.png` rides along, so the server never needs a browser.

## 3. Write the .env on the server

```bash
sudo -u linkinbio tee /srv/linkinbio/.env >/dev/null <<EOF
STATS_USER=admin
STATS_PASS=$(openssl rand -base64 24)
HASH_SALT=$(openssl rand -hex 24)
PORT=8787
HOST=127.0.0.1
SITE_URL=https://links.example.com
TRUST_PROXY=1
CLICKS_LOG=data/clicks.log
EOF
sudo chmod 600 /srv/linkinbio/.env
sudo cat /srv/linkinbio/.env | grep STATS_PASS   # save this in your password manager
```

`HOST=127.0.0.1` keeps the app off the public interface — only the reverse proxy
can reach it. `TRUST_PROXY=1` makes the app read the client IP from
`X-Forwarded-For`; leave it `0` if nothing is in front, or every visitor hashes
to the proxy's own address.

```bash
sudo mkdir -p /srv/linkinbio/data
sudo chown -R linkinbio:linkinbio /srv/linkinbio
```

## 4. Start it under systemd

```bash
sudo cp /srv/linkinbio/deploy/linkinbio.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now linkinbio
curl -s localhost:8787/healthz          # -> ok
```

## 5a. Caddy (recommended — certificates are automatic)

```bash
sudo apt install -y caddy
sudo cp /srv/linkinbio/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/links.example.com/YOUR-DOMAIN/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Point an `A` record at the server first — Caddy fetches the certificate on the
first request to that hostname and renews it on its own.

## 5b. nginx

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp /srv/linkinbio/deploy/nginx.conf /etc/nginx/sites-available/linkinbio
sudo sed -i 's/links.example.com/YOUR-DOMAIN/' /etc/nginx/sites-available/linkinbio
sudo ln -sf /etc/nginx/sites-available/linkinbio /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d YOUR-DOMAIN
```

Certbot rewrites the config with the TLS lines and installs a renewal timer.

## 6. Rotate the click log

```bash
sudo cp /srv/linkinbio/deploy/logrotate.conf /etc/logrotate.d/linkinbio
sudo logrotate -d /etc/logrotate.d/linkinbio     # dry run
```

Monthly, twelve months kept, `copytruncate` so the running server's open file
handle stays valid. Without this the log grows forever and `/stats` gets slower.

## Updating links after deploy

```bash
scp links.json root@your-server:/srv/linkinbio/links.json
```

That is the whole deploy for a content change — the running server picks it up on
the next request. Only re-run `npm run build` (and copy `public/og.png` up) when
the name, bio, avatar or link list changed and you want the social card to match.

## Backups

Only two files matter: `links.json` (your content) and `data/clicks.log` (your
history). Everything else is in the repo.

```bash
rsync -av root@your-server:/srv/linkinbio/data/ ./backup/data/
```

## Serving the page as a static file

`npm run build` also writes `dist/index.html` — the same page with no server
behind it. Useful behind a CDN. `/go/` and `/stats` still need the Node process,
so the reverse proxy has to route those two paths to it; the commented block at
the bottom of `deploy/Caddyfile` does exactly that.

The trade-off: the static copy has to be rebuilt after every `links.json` edit,
and the `Content-Security-Policy` in `dist/headers.txt` contains a hash of the
inline stylesheet, so that header changes on every rebuild too.

---

## Design

The page is a table of contents rather than a stack of buttons. Each row reads
`plate · title · leader dots · destination host · ↗`, which puts the real
destination in the right margin — you can see where a link goes before you tap
it, which the hosted services deliberately hide.

Left-aligned, one column, square avatar. Type is Iowan Old Style (falling back
through Palatino to Georgia) for the name, the system UI face for body text, and
the system monospace for anything that is data: hosts, counts, the log. All three
ship with the OS, so the page loads no webfonts and calls no CDN.

The accent is `#2440e8` — a deliberate, saturated cobalt, which is the one place
the design spends any boldness. It appears only on interaction: the leader dots
fill in, a 2px rule marks the left edge of the row, and the arrow moves. In dark
mode the interactive accent lightens to `#93a6ff` for contrast, while charts on
`/stats` use `#7488f0`, which is a step that stays inside the readable lightness
band for a filled mark on a dark surface.

To change the palette, edit `TOKENS` in `src/render.mjs`. Both the page and
`/stats` read from it; `src/og.mjs` keeps its own hardcoded copy because a
screenshot has no viewer to ask about `prefers-color-scheme`.

Accessibility floor: visible keyboard focus on every row, `prefers-reduced-motion`
turns off the entrance animation and all transitions, rows stay above 44px on
mobile, and the layout holds down to 320px.

## Security notes

- `Content-Security-Policy: default-src 'none'` with a SHA-256 hash for the one
  inline `<style>`. The page can load no script, no font and no frame, so a
  content injection has very little to work with.
- Static files are served only from `public/`, with the resolved path checked
  against that directory, so `..` traversal returns 404.
- `/go/:slug` only ever redirects to a URL that is already in `links.json`. The
  slug is a lookup key, never part of the destination, so there is no open
  redirect.
- `/stats` sends `X-Robots-Tag: noindex` and `robots.txt` disallows `/go/` and
  `/stats`.
- The systemd unit runs as a non-login user under `ProtectSystem=strict` with
  `data/` as the only writable path.
