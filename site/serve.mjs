// site/serve.mjs — local preview of _site/ under the same /vibe/ path as GitHub Pages.
//
//   node site/serve.mjs            http://localhost:4173/vibe/
//   PORT=8080 node site/serve.mjs
//
// Exported for tests: createServer({ siteDir, basePath }) -> http.Server (not listening).
// Mirrors Pages: "/" redirects to the base path, a folder without a trailing slash
// redirects to the slash form (relative links depend on it), and a missing file gets
// 404.html with status 404. Requests never escape siteDir.

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

export function createServer({ siteDir = resolve(HERE, "..", "_site"), basePath = "/vibe/" } = {}) {
  const root = resolve(siteDir);
  const notFound = (res) => {
    const page = join(root, "404.html");
    res.writeHead(404, { "content-type": TYPES[".html"] });
    res.end(existsSync(page) ? readFileSync(page) : "404");
  };

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return notFound(res);
    }
    if (path === "/" || path === basePath.slice(0, -1)) {
      res.writeHead(301, { location: basePath });
      return res.end();
    }
    if (!path.startsWith(basePath)) return notFound(res);

    const file = resolve(root, `.${sep}${path.slice(basePath.length)}`);
    if (file !== root && !file.startsWith(root + sep)) return notFound(res);
    if (!existsSync(file)) return notFound(res);

    let target = file;
    if (statSync(file).isDirectory()) {
      if (!path.endsWith("/")) {
        res.writeHead(301, { location: `${url.pathname}/${url.search}` });
        return res.end();
      }
      target = join(file, "index.html");
      if (!existsSync(target)) return notFound(res);
    }
    res.writeHead(200, { "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream" });
    createReadStream(target).pipe(res);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4173;
  const siteDir = resolve(HERE, "..", "_site");
  if (!existsSync(join(siteDir, "index.html"))) {
    console.error("✗ _site/ is empty. Run `pnpm site:build` first.");
    process.exit(1);
  }
  createServer({ siteDir }).listen(port, "127.0.0.1", () => console.log(`vibe preview: http://localhost:${port}/vibe/`));
}
