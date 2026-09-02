# Senja

Self-hosted testimonial collection, moderation, and display. Collect testimonials
through a public form, approve them privately, then show them on a hosted wall or
embed them in any site with one script tag.

One Node process, one SQLite file, avatars on disk. No build step, no external
services.

| Route              | Access     | What it is                                        |
| ------------------ | ---------- | ------------------------------------------------- |
| `/submit`          | public     | Collection form: name, role, rating, text, avatar |
| `/wall`            | public     | Masonry wall of approved testimonials             |
| `/admin`           | basic auth | Approve, unpublish, delete                        |
| `/embed.js`        | public     | The embeddable widget                             |
| `/api/testimonials`| public     | JSON of approved testimonials (CORS `*`)          |
| `/healthz`         | public     | Liveness probe                                    |

Nothing is publicly visible until it is approved: every submission is stored with
`approved = 0`, and `/wall`, `/embed.js` and the JSON API only ever read approved
rows.

## Quick start

```bash
npm install
cp .env.example .env      # then set ADMIN_PASSWORD
npm start                 # http://localhost:3000
```

Optionally load six sample testimonials so the wall is not empty:

```bash
npm run seed
```

Requires Node 20.11 or newer.

## Configuration

All settings come from `.env` (see `.env.example`).

| Variable                     | Default                    | Notes                                                      |
| ---------------------------- | -------------------------- | ---------------------------------------------------------- |
| `ADMIN_USER`                 | `admin`                    | Basic-auth username for `/admin`                            |
| `ADMIN_PASSWORD`             | *(none)*                   | **Required.** `/admin` returns 503 until this is set        |
| `SITE_NAME`                  | `Testimonials`             | Shown in the header and page titles                         |
| `SITE_TAGLINE`               | …                          | Sub-heading on the wall and the form                        |
| `SITE_URL`                   | *(derived from request)*   | Public origin; used for the embed snippet and avatar URLs   |
| `PORT` / `HOST`              | `3000` / `0.0.0.0`         | Bind `127.0.0.1` when nginx sits in front                   |
| `TRUST_PROXY`                | `loopback`                 | Express trust-proxy setting; correct behind nginx           |
| `DATA_DIR`                   | `./data`                   | SQLite file and uploaded avatars                            |
| `AVATAR_SIZE`                | `128`                      | Avatars are cropped square to this many pixels              |
| `MAX_UPLOAD_BYTES`           | `8388608`                  | 8 MB. Keep nginx `client_max_body_size` above this          |
| `SUBMIT_RATE_LIMIT`          | `5`                        | Accepted submissions per IP per hour; `0` disables          |
| `ALLOW_PRIVATE_AVATAR_HOSTS` | `false`                    | Leave off; see [Avatar URLs](#avatar-urls)                  |

## Embedding

Paste this into any page — the `/admin` page shows the snippet with your own
origin already filled in:

```html
<div id="senja-wall"></div>
<script src="https://testimonials.example.com/embed.js" async></script>
```

The widget renders real DOM into your page (no iframe) and sets
`font-family: inherit`, so the testimonials pick up the host page's typeface and
size. All sizing is in `em`, so it scales with the surrounding text.

Options go on the div, or on the script tag as defaults for the whole page:

| Attribute         | Default | Meaning                                     |
| ----------------- | ------- | ------------------------------------------- |
| `data-limit`      | `30`    | How many testimonials to show               |
| `data-columns`    | `3`     | Maximum columns; it still reflows to fit    |
| `data-theme`      | `auto`  | `auto` follows the reader's OS setting      |
| `data-min-rating` | `1`     | Hide anything below this rating             |
| `data-summary`    | `false` | Show the "4.8 average from 32 reviews" line |

```html
<div id="senja-wall" data-columns="2" data-limit="6" data-min-rating="4" data-theme="light"></div>
```

Multiple walls on one page work too — give each container
`data-senja-wall` instead of the `id`. `demo/embed-example.html` is a working
host page you can open locally.

## Deploying to a VPS

Ubuntu 24.04, nginx in front, systemd keeping it alive. Substitute your own
domain for `testimonials.example.com`.

**1. Install Node 22 and nginx**

```bash
sudo apt update && sudo apt install -y nginx curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

**2. Create a service user and directories**

The code lives in `/srv/senja` and is read-only to the service; everything the
app writes lives in `/var/lib/senja`.

```bash
sudo useradd --system --home /srv/senja --shell /usr/sbin/nologin senja
sudo mkdir -p /srv/senja /var/lib/senja
sudo chown senja:senja /var/lib/senja
```

**3. Install the app**

```bash
sudo git clone https://github.com/your-org/senja.git /srv/senja
cd /srv/senja
sudo npm ci --omit=dev
sudo chown -R senja:senja /srv/senja
```

**4. Configure it**

```bash
sudo -u senja cp .env.example .env
sudo -u senja nano .env
```

Set at least:

```ini
ADMIN_PASSWORD=<a long random password>
SITE_NAME=Acme
SITE_URL=https://testimonials.example.com
HOST=127.0.0.1
DATA_DIR=/var/lib/senja
```

`openssl rand -base64 24` makes a good password. Keep `HOST=127.0.0.1` so the app
is only reachable through nginx.

**5. Start it under systemd**

```bash
sudo cp /srv/senja/deploy/senja.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now senja
sudo systemctl status senja
```

**6. Put nginx in front and get a certificate**

```bash
sudo cp /srv/senja/deploy/nginx.conf /etc/nginx/sites-available/senja
sudo sed -i 's/testimonials.example.com/your-real-domain.com/' /etc/nginx/sites-available/senja
sudo ln -s /etc/nginx/sites-available/senja /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-real-domain.com
```

Certbot rewrites the nginx file to add TLS and the HTTP→HTTPS redirect, and
installs a renewal timer.

**7. Firewall**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Visit `https://your-real-domain.com/admin` and log in with `ADMIN_USER` /
`ADMIN_PASSWORD`.

### Updating

```bash
cd /srv/senja
sudo git pull
sudo npm ci --omit=dev
sudo systemctl restart senja
```

### Backups

Everything worth keeping is in `/var/lib/senja`. Use SQLite's online backup so
you get a consistent copy of a live database — copying the file directly while
the server is running can capture a torn write:

```bash
sudo -u senja sqlite3 /var/lib/senja/senja.db ".backup '/var/backups/senja-$(date +%F).db'"
sudo tar czf /var/backups/senja-avatars-$(date +%F).tar.gz -C /var/lib/senja uploads
```

A nightly cron entry:

```cron
15 3 * * * sudo -u senja sqlite3 /var/lib/senja/senja.db ".backup '/var/backups/senja-$(date +\%F).db'"
```

## Notes on the design

**Moderation is the default.** `approved` defaults to `0` at the schema level, and
every public read path filters on `approved = 1`.

**Avatars are re-encoded, never passed through.** Uploads go to memory, not disk.
sharp decodes the image, honours the EXIF orientation, crops it square with an
attention-based crop, and writes a fresh 128px WebP under a UUID filename. The
original bytes are discarded, so a file that merely claims to be an image (or
carries a payload in its metadata) does not survive.

<a name="avatar-urls"></a>**Avatar URLs are fetched defensively.** When someone
supplies a URL instead of a file, the server resolves the hostname and refuses
any address in a private, loopback, link-local, or carrier-grade-NAT range —
which is what blocks `169.254.169.254` and friends. Redirects are followed
manually so each hop gets the same check, the response is capped as it streams,
and the request times out after six seconds.

**Basic auth is compared in constant time**, over SHA-256 digests so the
comparison length does not leak. Admin mutations additionally require a
same-origin `Origin`/`Sec-Fetch-Site`, because browsers will replay cached
basic-auth credentials on a cross-site form POST.

**Spam control** is a hidden honeypot field plus a per-IP hourly limit. Only
*accepted* submissions count against the limit, so someone who mistypes the form
five times is not locked out. A bot that fills the honeypot gets a normal-looking
success page and nothing is stored.

## Project layout

```
server.js              routes, auth, rate limiting, validation
src/config.js          env parsing and paths
src/db.js              schema and prepared statements
src/avatar.js          resizing, URL fetching, SSRF guards
src/ui.js              design tokens, layout, shared components
src/pages/             submit, wall, admin
public/embed.js        the embeddable widget
deploy/                systemd unit and nginx config
demo/                  a host page showing the embed
```
