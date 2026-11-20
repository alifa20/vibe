# vibe

Fourteen small apps I built with AI. Each folder is a self-contained project with
its own README, stack and setup. Nothing is shared between them. One of them,
myshot, lives in [its own repo](https://github.com/alifa20/myshot) for now.

**Browse them at <https://alifa20.github.io/vibe/>.** Five run right in the
browser. The other nine need a server, so their page shows what they do and how
to run them.

| Project | What it is | Stack | On the site |
|---|---|---|---|
| [teleprompter](teleprompter/) | a local, single-page teleprompter. scripts stay in your browser. | vite + react + ts | [live demo](https://alifa20.github.io/vibe/teleprompter/) |
| [personal-site](carrd/) | one-page personal site. content.json is the whole cms. _(inspired by Carrd)_ | node build → static html | [live demo](https://alifa20.github.io/vibe/carrd/) |
| [golinks](bitly/) | link shortener with click analytics and qr codes on your own domain. _(inspired by Bitly)_ | cloudflare workers + kv + d1 | [how to run it](https://alifa20.github.io/vibe/bitly/) |
| [linkinbio](linktree/) | link-in-bio page with first-party click tracking. zero dependencies. _(inspired by Linktree)_ | node, no deps | [how to run it](https://alifa20.github.io/vibe/linktree/) |
| [qrforge](qr/) | qr generator with editable dynamic codes and scan tracking. | express + sqlite | [how to run it](https://alifa20.github.io/vibe/qr/) |
| [senja](senja/) | collect, approve and embed testimonials. _(inspired by Senja)_ | express + sqlite | [how to run it](https://alifa20.github.io/vibe/senja/) |
| [forms](tally/) | a small form builder. responses stay in a sqlite file you control. _(inspired by Tally)_ | express + sqlite | [how to run it](https://alifa20.github.io/vibe/tally/) |
| [zcal](zcal/) | single-user scheduling: read one calendar, publish your free time, book a slot. _(inspired by Zcal)_ | next.js + sqlite | [how to run it](https://alifa20.github.io/vibe/zcal/) |
| [pdf-tools](ilovepdf/) | merge, split, organise, convert and compress pdfs. nothing leaves your browser. _(inspired by iLovePDF)_ | vite + ts + pdf-lib + pdf.js + qpdf wasm | [live demo](https://alifa20.github.io/vibe/ilovepdf/) |
| [sitecrawl](screamingfrog/) | seo crawler for one site. broken links, redirects, titles, canonicals and sitemap gaps in one html report. _(inspired by Screaming Frog)_ | node cli + cheerio | [sample report](https://alifa20.github.io/vibe/screamingfrog/) |
| [analytics](plausible/) | cookie-free web analytics. one script tag, pageviews in a sqlite file you own. _(inspired by Plausible)_ | express + sqlite | [how to run it](https://alifa20.github.io/vibe/plausible/) |
| [invoices](invoiceninja/) | clients, line items and invoices with exact money and gap-free numbers. prints to pdf. _(inspired by Invoice Ninja)_ | express + sqlite | [how to run it](https://alifa20.github.io/vibe/invoiceninja/) |
| [uptime](betterstack/) | uptime and cron monitoring: http checks, heartbeats, tls expiry warnings, email alerts. _(inspired by Better Stack)_ | express + sqlite | [how to run it](https://alifa20.github.io/vibe/betterstack/) |
| [myshot](https://github.com/alifa20/myshot) | screenshot beautifier: padding, shadow, background, crop and arrows, exported as a png. _(own repo)_ | one html file, vanilla js | [live app](https://alifa20.github.io/myshot/) |

The names, descriptions and stacks above match `site/projects.json`, which
drives the site. If you change one, change the other.

## Running a project

Open the project's folder and follow its README. Each one lists its own
requirements (Node version, SQLite, Cloudflare account and so on).

## The site

`site/` holds a zero-dependency Node build that turns `site/projects.json` into
the GitHub Pages site: the hub, a page for each server app, a 404 page, and the
demos built in this repo, each with a shared nav strip injected on top.

```sh
pnpm site:test   # node:test suite for the build, nav and preview server
pnpm site:build  # builds every demo from source and assembles _site/
pnpm site:check  # checks every inline style/script in _site/ is allowed by its CSP
pnpm site:serve  # previews _site/ at http://localhost:4173/vibe/
```

`pnpm site:build` needs each demo's dependencies first: run `pnpm site:install`. Pass
`--skip-build` (`node site/build.mjs --skip-build`) to reuse existing demo
builds.

### Deploying

`.github/workflows/pages.yml` runs the tests and the build on every pull
request, and deploys `_site/` on every push to `main`. Before the first
deploy, set **Settings → Pages → Source** to **GitHub Actions** (or run
`gh api -X POST repos/alifa20/vibe/pages -f build_type=workflow`). The
workflow can't turn Pages on by itself.
