# golinks

A link shortener with click analytics and QR codes, running on your own domain
on Cloudflare Workers. KV holds the slug lookup, D1 holds the click log. No
accounts, no third-party analytics, no telemetry — one password guards the
admin, and the only place your traffic data lives is your own D1 database.

```
go.mydomain.com/{slug}     302 to the destination; the click lands in D1 afterwards
go.mydomain.com/qr/{slug}  PNG QR code of the short link, cached at the edge
go.mydomain.com/admin      password-protected analytics
go.mydomain.com/api/links  the same operations, for scripts
```

---

## ⚠️ These links die with the domain

Every short link and every printed QR code points at **your** hostname. If the
domain lapses, changes hands, or moves off Cloudflare, all of them break at
once — and unlike bit.ly there is no company left running a redirect for you.
A poster with a dead QR code is worse than a poster with no QR code, and you
cannot recall printed material.

So before you print anything:

- Use a domain you intend to keep renewing for **as long as the printed
  material will be in circulation** — often years longer than the campaign.
- Turn on auto-renew, and make sure the billing card on the registrar account
  is one that will still be valid in three years.
- Do not use a domain tied to a single project, client or job that might end.
- Keep the D1 export (below) somewhere safe. It is the record of what pointed
  where, and it is what lets you rebuild the same slugs on a new domain.

---

## Setup

You need a Cloudflare account (free) and a domain whose nameservers already
point at Cloudflare.

### 1. Install and sign in

```sh
npm install
npx wrangler login
npx wrangler telemetry disable   # optional: stops wrangler's own usage reporting
```

### 2. Create the KV namespace

KV is the slug lookup the redirect path reads. One read per click.

```sh
npx wrangler kv namespace create LINKS
```

It prints an `id`. Put it in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "LINKS"
id = "the-id-it-printed"
```

### 3. Create the D1 database

D1 is the click log and the authority on which slugs exist.

```sh
npx wrangler d1 create golinks
```

Put the `database_id` it prints into `wrangler.toml`, then create the tables —
once for the deployed database, and once for the local one used by
`wrangler dev`:

```sh
npm run db:init         # --remote, the real database
npm run db:init:local   # the local copy for development
```

### 4. Set your domain and fallback

In `wrangler.toml`, replace `mydomain.com` in all three places:

```toml
routes = [{ pattern = "go.mydomain.com", custom_domain = true }]

[vars]
SHORT_DOMAIN = "go.mydomain.com"      # used to build short links and QR codes
FALLBACK_URL = "https://mydomain.com/" # where expired and capped links go
```

`FALLBACK_URL` is also where the bare root of the domain sends people.

### 5. Set the admin password

Secrets never go in `wrangler.toml`. This is the only one:

```sh
npx wrangler secret put ADMIN_PASSWORD
```

The same value is the API bearer token. Changing it signs out every open admin
session, because it is also the key the session cookie is signed with.

### 6. Deploy

```sh
npm run deploy
```

### 7. The DNS record

`custom_domain = true` means **wrangler creates the DNS record for you** on the
first deploy: a proxied record for `go.mydomain.com` pointing at the worker,
plus the certificate. Nothing to do by hand — but:

- The zone (`mydomain.com`) must already be in the same Cloudflare account.
- If `go.mydomain.com` already has a DNS record, the deploy fails rather than
  overwriting it. Delete the old record in the Cloudflare dashboard
  (**DNS → Records**) and deploy again.
- Give the certificate a minute on first deploy. Until it is issued you may see
  a TLS error.

If you would rather manage DNS yourself, swap the custom domain for a route:

```toml
routes = [{ pattern = "go.mydomain.com/*", zone_name = "mydomain.com" }]
```

and add a **proxied** (orange cloud) `AAAA` record for `go` pointing at `100::`.
The proxy is what puts the worker in front of the hostname; a grey-cloud record
will not work.

---

## Using it

### The admin

`https://go.mydomain.com/admin`, one password. It shows:

- clicks per day across all links, for the last 7 / 30 / 90 days
- every link with a 14-day trend, clicks in range, all-time clicks and status
- per link: clicks per day, top countries, device split, referrers, the last 25
  clicks, and the QR code with print-size downloads

Sessions last 12 hours. Every chart has a table view beside it, so nothing is
readable only by hovering.

### Creating links from the command line

```sh
# random 6-character back-half
curl -X POST https://go.mydomain.com/api/links \
  -H "authorization: Bearer $ADMIN_PASSWORD" \
  -H 'content-type: application/json' \
  -d '{"url": "https://example.com/some/long/page"}'

# custom back-half, expires in 30 days, capped at 500 clicks
curl -X POST https://go.mydomain.com/api/links \
  -H "authorization: Bearer $ADMIN_PASSWORD" \
  -H 'content-type: application/json' \
  -d '{"url": "https://example.com/launch", "slug": "launch",
       "expiresAt": "30d", "maxClicks": 500,
       "fallbackUrl": "https://example.com/campaign-over"}'
```

Other endpoints: `GET /api/links`, `GET /api/links/{slug}`,
`PATCH /api/links/{slug}`, `DELETE /api/links/{slug}`.

**Creating a slug that already exists fails with `409` and changes nothing.**
Nothing in this project overwrites an existing link — not the API, not the
admin form. To repoint a slug, edit it explicitly.

`expiresAt` takes a relative offset (`30d`, `12h`, `45m`, `2w`) or an absolute
time (`2026-09-30T17:00`, read as UTC).

### QR codes

```
/qr/{slug}                            512px PNG
/qr/{slug}?size=1024&download=1       print size, as a file download
/qr/{slug}?size=2048&ecc=H            high error correction, survives overprinting
```

The QR encodes the **short link**, never the destination. So a scan is a
tracked click, and you can repoint the destination after the posters are
printed. Images are cached at the edge for 30 days and in the browser for a
day; deleting a link purges its cached PNGs.

---

## How it works

**The redirect path is one KV read.** `GET /{slug}` reads the KV record, returns
a `302`, and hands the click to `ctx.waitUntil()` — so the D1 insert happens
after the response has already gone to the visitor. If D1 is slow or erroring,
the redirect is unaffected and the failure is logged instead.

**Expiry and click caps end in a redirect, not a 404.** Past either limit the
visitor gets a `302` to the link's own `fallbackUrl`, or to `FALLBACK_URL` if it
has none. The click is still logged, with `outcome` recording `expired`,
`capped` or `disabled` — so the admin can tell you how much traffic arrived
after a campaign ended. An unknown slug is a plain 404; the fallback is for
links that existed, not for typos.

**Click caps are enforced from KV, so they can overshoot slightly.** The exact
count lives in D1. When a click takes a link to its cap, the same `waitUntil`
that logs it flips a flag in the KV record. KV takes up to about a minute to
propagate worldwide, so a link getting heavy simultaneous traffic can serve a
few clicks past its cap. The same window applies to edits: changing a
destination reaches every location within about a minute.

**Device type is parsed from the user-agent** into `desktop`, `mobile`,
`tablet`, `bot` or `unknown`. Link-preview fetchers (Slack, WhatsApp, Twitter,
etc.) count as `bot`, so they do not inflate your human numbers — the admin
shows the bot share for the range.

**Country and city come from `request.cf`**, which Cloudflare fills in at the
edge. No IP address is stored, and no IP-lookup service is involved.

---

## Free tier

At the time of writing the free tier gives you 100,000 Worker requests/day,
100,000 KV reads and 1,000 KV writes/day, and 5 million D1 rows read and
100,000 rows written per day. (Cloudflare's limits change; check the current
[Workers](https://developers.cloudflare.com/workers/platform/limits/),
[KV](https://developers.cloudflare.com/kv/platform/limits/) and
[D1](https://developers.cloudflare.com/d1/platform/limits/) pages.)

What each thing costs:

| Action | Cost |
|---|---|
| One click | 1 Worker request, 1 KV read, 2 D1 row writes |
| Creating or editing a link | 1 KV write, 1–2 D1 row writes |
| A cached QR scan | nothing (served from the edge cache) |
| An admin page view | a handful of D1 row reads |

The binding constraint is D1 writes: **roughly 50,000 clicks a day** on the free
tier. KV's 1,000 writes/day only limits how many links you create or edit per
day, not how many clicks you serve.

---

## Local development

```sh
cp .dev.vars.example .dev.vars    # set a local ADMIN_PASSWORD
npm run db:init:local             # once
npm run dev                       # http://127.0.0.1:8787
```

`.dev.vars` is gitignored and never deployed. Local KV and D1 are stored under
`.wrangler/` and are entirely separate from production.

## Backing up

The click log and the link table are both in D1:

```sh
npx wrangler d1 export golinks --remote --output=golinks-backup.sql
```

Keep the export somewhere outside Cloudflare. It is what lets you rebuild every
slug — and therefore every printed QR code — if you ever have to move.

To restore the KV lookup after importing into a new database, re-save each link
through `PATCH /api/links/{slug}` (any edit rewrites the KV record from D1).

## Layout

```
src/index.js      routing, the redirect hot path, the JSON API, error pages
src/links.js      create / update / delete, and keeping KV in step with D1
src/clicks.js     user-agent parsing and the waitUntil click write
src/qr.js         QR rendering and the cached /qr/ endpoint
src/png.js        a small 1-bit PNG encoder (the qrcode package's own PNG
                  writer needs node streams and zlib; this avoids both)
src/admin.js      admin routing, auth, dashboard and per-link pages
src/admin-ui.js   the stylesheet and page chrome
src/charts.js     server-rendered SVG charts, no client-side library
schema.sql        the two D1 tables
```
