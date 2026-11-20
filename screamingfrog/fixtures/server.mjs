// A local stand-in for a real website, used by the tests and the sample report.
//
//   startFixtureSites({ root }) -> { origin, externalOrigin, requests, externalRequests, close() }
//
// Two servers on 127.0.0.1 with ephemeral ports:
//   - the site: static files from fixtures/site/, plus the special responses in
//     fixtures/site/_routes.json (redirects, extra headers, a 429 once, a gzipped file).
//     "{{ORIGIN}}" and "{{EXTERNAL}}" in text files become the two origins.
//   - an "external" site on a different port, so cross-origin link checks never
//     leave the machine: /ok is 200, /gone is 404, /head-refused is 405 for HEAD.

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = fileURLToPath(new URL("./site/", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const listen = (server) =>
  new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${server.address().port}`));
  });

const NOT_FOUND = "<!doctype html><title>Not found</title><h1>Not found</h1>";

export async function startFixtureSites({ root = DEFAULT_ROOT } = {}) {
  const base = resolve(root);
  const routes = JSON.parse(readFileSync(join(base, "_routes.json"), "utf8"));
  const requests = [];
  const externalRequests = [];
  const busyCount = new Map();
  let origin = "";
  let externalOrigin = "";

  const fill = (text) => text.replaceAll("{{ORIGIN}}", origin).replaceAll("{{EXTERNAL}}", externalOrigin);
  const readText = (file) => fill(readFileSync(file, "utf8"));

  const site = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    requests.push({ method: req.method, path });
    const route = routes[path] ?? {};
    const send = (status, headers, body = "") => {
      res.writeHead(status, { ...headers, ...(route.headers ?? {}) });
      res.end(req.method === "HEAD" ? undefined : body);
    };

    if (route.location) return send(route.status ?? 301, { location: route.location });
    if (route.busyOnce) {
      const n = (busyCount.get(path) ?? 0) + 1;
      busyCount.set(path, n);
      if (n === 1) return send(429, { "retry-after": String(route.busyOnce), "content-type": "text/plain" }, "slow down");
    }
    if (route.gzip) {
      const body = gzipSync(readText(join(base, route.gzip)));
      return send(200, { "content-type": "application/gzip" }, body);
    }

    let file = normalize(join(base, path));
    if (!file.startsWith(base) || path.includes("/_")) return send(404, { "content-type": TYPES[".html"] }, NOT_FOUND);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return send(404, { "content-type": TYPES[".html"] }, NOT_FOUND);
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    return send(200, { "content-type": type }, TYPES[extname(file)] ? readText(file) : readFileSync(file));
  });

  const external = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    externalRequests.push({ method: req.method, path });
    const html = { "content-type": TYPES[".html"] };
    if (path === "/ok") {
      res.writeHead(200, html);
      return res.end(req.method === "HEAD" ? undefined : `<!doctype html><title>Mill</title><a href="/deeper">deeper</a>`);
    }
    if (path === "/head-refused") {
      if (req.method === "HEAD") {
        res.writeHead(405, { allow: "GET" });
        return res.end();
      }
      res.writeHead(200, html);
      return res.end("<!doctype html><title>Guide</title>");
    }
    res.writeHead(404, html);
    res.end(req.method === "HEAD" ? undefined : NOT_FOUND);
  });

  origin = await listen(site);
  externalOrigin = await listen(external);

  return {
    origin,
    externalOrigin,
    requests,
    externalRequests,
    close: () =>
      Promise.all([site, external].map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }))),
  };
}
