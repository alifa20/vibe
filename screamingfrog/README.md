# sitecrawl

A small SEO crawler you run from the terminal, inspired by Screaming Frog. Point
it at a website. It walks every page it can reach on that site, checks the links
going out, and writes one HTML report: broken links, redirect chains and loops,
title and description problems, headings, canonicals, noindex pages and sitemap
gaps.

The report is a single file. It runs no script and loads nothing, so you can
email it, attach it to a ticket or open it offline.

```
bin/crawl.mjs             the command: parse flags, crawl, audit, write the report
src/crawl.mjs             robots.txt, sitemaps, then a breadth-first walk of one origin
src/fetch.mjs             requests with a size cap, a retry on 429/503, redirects followed by hand
src/robots.mjs            robots.txt parser and matcher (RFC 9309)
src/sitemap.mjs           sitemap and sitemap-index files, gzipped or not
src/extract.mjs           pulls title, description, H1s, canonical, robots tags, images and links from a page
src/url.mjs               URL normalisation
src/audit.mjs             the checks: plain functions from page records to issues
src/report.mjs            the HTML report
scripts/sample-report.mjs builds the sample report from the bundled fixture site
fixtures/site/            a small bakery website with one of every problem the report knows about
fixtures/server.mjs       serves that site (and a stand-in "other site") on 127.0.0.1
```

## Quick start

Needs Node 22 or newer and pnpm.

```sh
cd screamingfrog
pnpm install
pnpm crawl https://your-site.example/ --out report.html
open report.html
```

`pnpm sample` crawls the bundled fixture site and writes `sample/index.html`,
which is the same report the project page shows. `pnpm test` runs the tests.

To use it as a command anywhere, `pnpm link --global` inside this folder, then
run `sitecrawl <url>`.

## Options

| Flag | Default | What it does |
|---|---|---|
| `--max-pages <n>` | 10000 | Stop queuing new URLs once this many are known. |
| `--max-depth <n>` | no limit | How many clicks from the start URL to follow. `0` crawls only the start page. |
| `--concurrency <n>` | 3 | Requests to the site in flight at once. |
| `--delay <ms>` | 0 | Pause after each request, per worker. Use it on small or shared hosts. |
| `--max-body-size <size>` | 5MB | Pages bigger than this are cut off and not parsed. Accepts `500kB`, `2MB` or a byte count. |
| `--user-agent <ua>` | `sitecrawl/1.0 (+…)` | Sent with every request. Its first word is the name matched against `User-agent:` lines in robots.txt. |
| `--out <file>` | `sitecrawl-report.html` | Where the report goes. |

## What it records

For every URL it visits: the status code, every redirect hop, the response
time, the HTML size, the click depth, the title, the meta description, the H1s,
the canonical, robots directives from both the `<meta name="robots">` tag and
the `X-Robots-Tag` header, images with no `alt` attribute, and the links on the
page.

## What the report flags

| Check | Severity |
|---|---|
| Broken internal links (4xx, 5xx, connection failures), with the pages that link to them | error |
| Broken external links | error |
| Redirect loops | error |
| Canonical pointing at an error page | error |
| Canonical pointing at a redirect, or at a noindex page | warning |
| Redirect chains of two hops or more | warning |
| Missing or duplicate titles, titles over 60 characters | warning / notice |
| Missing or duplicate meta descriptions, descriptions over 155 characters | warning / notice |
| Missing H1, more than one H1 | warning / notice |
| Noindex pages | notice |
| Sitemap URLs the crawl never reached | warning |
| Sitemap URLs that redirect, error, are blocked, are noindex, or name another canonical | warning |
| Images without alt text | notice |

The report opens with the totals and a table of every check with its count.
Each check that found something links down to its own section. After that
comes every crawled page, sorted by status, then the external links and the
sitemap files.

## How it works

1. **robots.txt first.** It fetches `/robots.txt` and follows RFC 9309: the
   group for its own name wins, otherwise `*`; the longest matching rule
   decides; `Allow` wins a tie; `*` and `$` work as wildcards. A 4xx means
   everything is allowed. A 5xx or an unreachable server means nothing is
   crawled. Blocked URLs show up in the report but are never requested.
2. **Sitemaps.** It reads the `Sitemap:` lines from robots.txt, or
   `/sitemap.xml` if there are none. Sitemap index files and `.gz` files work.
3. **The walk.** Starting from your URL, it goes one click depth at a time. It
   stays on the start URL's origin (scheme, host and port). Links to other sites
   are only checked, never crawled. `mailto:`, `tel:`, `javascript:` and `data:`
   links are skipped. URLs are compared after lowercasing the scheme and host
   and dropping the `#fragment` and default port. Query strings are kept, so
   `?page=1` and `?page=2` are different pages. `<base href>` is respected.
   Canonical URLs and redirect targets on the same site are crawled too, so
   their status can be checked.
4. **Redirects by hand.** Every hop is recorded, up to 10. A URL that comes
   back around is recorded as a loop rather than followed forever.
5. **Being polite.** Three requests at a time by default, an optional delay,
   and a 429 or 503 with a `Retry-After` header is retried once after the wait.
   Pages that ask for `nofollow` don't have their links followed.
6. **External links** are checked two at a time with `HEAD`, falling back to
   `GET` when a server answers `HEAD` with 405.
7. **Audits** run over the finished list of pages, and the report is written in
   one go. The same site always gives the same order of pages and issues.

Only the HTML the server sends is read. JavaScript is not run, so pages that
build their content in the browser will look empty.

If your start URL redirects to another host (for example `http://` to
`https://www.`), start from the final address, since the crawl stays on the
origin you give it.

## The sample report

`scripts/sample-report.mjs` starts two servers on `127.0.0.1` with random free
ports: the fixture site in `fixtures/site/`, and a second one standing in for
"another website" so external link checks never leave your machine. It crawls
the first, writes `sample/index.html`, and shuts both down. `sample/` is in
`.gitignore`.

Because the ports change on every run, the script replaces the two local
origins with fixed placeholder hosts before writing the report:
`https://bakery.example` for the site and `https://elsewhere.example` for the
other one. `.example` is reserved and never resolves, so in the sample the URLs
are shown as plain text, not links. Response times are hidden too. Two runs
produce byte-identical files.

The fixture site holds at least one case of every check in the table above.
`_routes.json` next to it adds what static files can't: redirects, a loop, an
`X-Robots-Tag` header, a 429 that clears on retry, and a gzipped sitemap.

## Deploying

There's nothing to deploy. It's a command-line tool: run it on your laptop or in
a scheduled CI job and keep the report as a build artifact.

## Security notes

- Everything in the report that came from a crawled site (titles, URLs,
  descriptions, headings, error text) is HTML-escaped. A page titled
  `<script>alert(1)</script>` shows up as text.
- The report contains no script. Its CSS sits in one inline `<style>` allowed
  by hash in the page's own Content-Security-Policy, with `default-src 'none'`,
  so even if escaping were ever missed, nothing in the file could run or load.
- Links to crawled pages carry `rel="nofollow noopener noreferrer"` and the
  report sets `referrer` to `no-referrer`.
- Response bodies are capped by `--max-body-size`, and each request times out
  after 20 seconds.
- The crawler goes wherever your start URL points, including private network
  addresses. Don't run it on URLs supplied by people you don't trust.

## Out of scope

- JavaScript rendering.
- A web UI or saved crawl history. Each run writes one file.
- Crawling several origins or subdomains in one run.
- Exporting to CSV or a spreadsheet.
- Logging in to crawl pages behind authentication.
