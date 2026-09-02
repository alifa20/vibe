# Personal site

A one-page personal site. `content.json` is the CMS — edit it, run the build,
and the whole page is regenerated as static HTML with the CSS inlined.

No framework, no build dependencies, no webfonts, no third-party anything.
Lighthouse: **100 / 100 / 100 / 100** on desktop and throttled mobile.

```
content.json      ← everything you edit
src/styles.css    ← the design (inlined into the page at build time)
src/app.js        ← ~1 kB of progressive enhancement for the form
build.mjs         ← content.json + src/ → dist/
server.mjs        ← serves dist/ and appends the form to messages.log
api/contact.js    ← the same endpoint as a serverless function
dist/             ← generated; safe to delete at any time
```

---

## Editing the site

Everything lives in `content.json`.

| Key | What it does |
| --- | --- |
| `site.url` | Your canonical URL. Drives OG tags, sitemap and JSON-LD. Set this before deploying. |
| `site.title` / `site.description` | Optional overrides. Left `null`, they're derived from your name, headline and about text. |
| `theme.accent` / `theme.accentDark` | The one accent colour, per colour scheme. The build warns if either fails WCAG AA. |
| `name`, `headline`, `about` | The masthead. `headline` is set in italic serif under your name. |
| `status` | Optional line above your name with a small accent dot. Delete the key to hide it. |
| `avatar` | Path to a photo. If the file is missing, a monogram is generated for you at that path. |
| `social[]` | `{ label, url }`. `mailto:` works. Rendered in order. |
| `work.projects[]` | `{ title, description, url }`. Omit the whole `work` key to drop the section. |
| `contact.*` | Section heading, intro, button label, and the thank-you wording. |
| `footer` | The right-hand footer line. |

Then:

```sh
npm run build      # regenerate dist/
npm run dev        # build, serve on :3000, rebuild on save
npm start          # build, then serve (what you run in production)
```

`npm run dev` watches `content.json`, `src/` and `build.mjs`, and rebuilds on
the next request after you save.

### The design

`src/styles.css` holds a small set of tokens at the top — `--accent`, three
text greys, a rule colour, a serif and a sans stack. Both colour schemes are
defined there; `prefers-color-scheme` picks between them. Change the tokens
and the whole page moves with them.

Type is set in the system serif (Iowan Old Style / Palatino / Georgia) for
display and the system UI sans for body copy, so there are no font files to
download and no layout shift. If you want a real webfont, self-host the
`.woff2` in `assets/`, add an `@font-face` to `src/styles.css` with
`font-display: swap`, and preload it — anything fetched from a third-party
domain will be blocked by the Content-Security-Policy the build emits.

### The OG image

`dist/og.png` (1200×630) is generated from your name, headline and accent on
every build. It needs a rasteriser — Chrome, `rsvg-convert` or ImageMagick,
whichever it finds first. If none is available it keeps the previous PNG and
warns; set `CHROME_PATH` to point at a browser explicitly.

---

## Deploying

### A VPS (Node + reverse proxy)

The form writes to a file, so this is the setup that needs no third party.

```sh
git clone <your repo> /srv/site && cd /srv/site
npm run build
```

`/etc/systemd/system/site.service`:

```ini
[Unit]
Description=Personal site
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/site
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=TRUST_PROXY=1
Environment=MESSAGES_LOG=/var/lib/site/messages.log
ExecStart=/usr/bin/node server.mjs
Restart=always

# The service only ever needs to write its message log.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/lib/site

[Install]
WantedBy=multi-user.target
```

```sh
install -d -o www-data -g www-data /var/lib/site
systemctl enable --now site
```

Then put TLS in front of it. Caddy, which gets you a certificate automatically:

```caddyfile
example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Or nginx:

```nginx
server {
    server_name example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `TRUST_PROXY=1` (as above) so rate limiting sees the real client IP rather
than the proxy's. Run `certbot --nginx -d example.com` for the certificate.

**Redeploying** is `git pull && npm run build && systemctl restart site`. The
restart isn't strictly required — the server notices a rebuild and reloads the
new CSP on the next request — but it's the honest habit.

### A static host + serverless form

`dist/` is a plain folder of files; any static host will serve it. The form
then needs a function, because serverless filesystems don't persist — you
can't append to `messages.log` there. `api/contact.js` forwards the message
instead.

**Vercel.** `vercel.json` is already set up (`node build.mjs` → `dist/`, with
`api/contact.js` picked up automatically):

```sh
vercel link
vercel env add CONTACT_WEBHOOK_URL   # optional; see below
vercel deploy --prod
```

**Netlify.** Build command `node build.mjs`, publish directory `dist`. Move
`api/contact.js` to `netlify/functions/contact.js` and add a redirect from
`/api/contact` to `/.netlify/functions/contact` in `netlify.toml`. The build
writes `dist/_headers`, which Netlify reads on its own.

**Cloudflare Pages.** Build command `node build.mjs`, output `dist`. Move
`api/contact.js` to `functions/api/contact.js` — Pages Functions use the same
Web-standard handler signature, so no code changes. `_headers` is read as-is.

**Where the messages go.** Set `CONTACT_WEBHOOK_URL` to any URL that accepts a
JSON POST — a Slack or Discord incoming webhook, a Zapier/n8n hook, your own
inbox service. The payload carries `text` (Slack), `content` (Discord) and the
raw `{ ts, name, email, message, ip, ua }` fields, so all three work. With no
webhook set, messages go to the function's runtime log (`vercel logs`), which
is fine for a quiet site but is not a durable inbox.

For durable storage without a third party, swap the webhook call for your
platform's store — Vercel Blob, a Postgres row, a Cloudflare KV write. It's
one `await` in one place, marked with a comment.

### A static host with no form at all

Deploy `dist/` and delete the contact section from `content.json`, or point
the form at your email by replacing `action="/api/contact"` with a `mailto:`
link in the intro. The rest of the page has no server requirement whatsoever.

---

## Reading your messages

`messages.log` is JSON Lines — one message per line, appended, never rewritten.

```sh
tail -f messages.log                                  # watch them arrive
jq -r '"\(.ts)  \(.name) <\(.email)>\n\(.message)\n"' messages.log
jq -r 'select(.ts > "2026-09")' messages.log          # this month
```

Bot submissions that trip the honeypot go to `messages.spam.log` instead, so
you can see what was filtered without it touching your inbox.

Back it up like any other file (`rsync`, a nightly `cp` to object storage) and
rotate it if it ever grows — `/etc/logrotate.d/site`:

```
/var/lib/site/messages.log {
    monthly
    rotate 24
    compress
    copytruncate
    notifempty
}
```

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Bind address — use `127.0.0.1` behind a proxy |
| `MESSAGES_LOG` | `./messages.log` | Where messages are appended |
| `SPAM_LOG` | `./messages.spam.log` | Where honeypot hits are recorded |
| `TRUST_PROXY` | unset | Set to `1` to read the client IP from `X-Forwarded-For` |
| `RATE_MAX` | `5` | Submissions allowed per window, per IP |
| `RATE_WINDOW_MS` | `600000` | The window, in milliseconds |

---

## How the spam handling works

Three layers, none of which asks a human to prove anything:

1. **Honeypot.** The form carries a `company` field, positioned off-screen,
   `aria-hidden`, `tabindex="-1"` and never autofilled. A person can't see or
   reach it; a bot filling every input will. When it's filled the server
   returns a normal success response and quietly files the message under
   `messages.spam.log` — the bot gets no signal that it was caught.
2. **Rate limiting.** Five messages per IP per ten minutes, in memory.
3. **Validation.** Length caps on every field, a real email shape, and a 64 kB
   body limit so a large POST can't tie up the process.

No CAPTCHA, no third-party script, no cookie, nothing to consent to.

## Why it scores 100

- The CSS is inlined, so the page renders from a single request with nothing
  render-blocking. The only subresources are the avatar and the favicon.
- No webfonts, so no swap-in reflow. `width`/`height` on the avatar and
  `text-wrap` on headings keep layout shift at zero.
- ~1 kB of JavaScript, loaded at the end of the body, doing nothing until you
  submit the form. Without it the form still posts and the server answers with
  a matching thank-you page.
- A strict Content-Security-Policy with real hashes of the inlined style and
  script — shipped as a `<meta>` (so it holds on a static host with no config)
  and as a header, where `frame-ancestors` also applies.
- Landmarks, one `h1`, labelled inputs, visible focus rings, a skip link, and
  every colour checked against WCAG AA in both schemes at build time.
