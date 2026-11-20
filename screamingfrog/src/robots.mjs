// robots.txt per RFC 9309.
//
//   parseRobots(text)              -> { groups: [{ agents, rules: [{ allow, pattern }] }], sitemaps }
//   robotsFor({ status, body }, ua) -> { isAllowed(pathAndQuery), sitemaps, note }
//   productToken(userAgent)        -> lowercased name before the first "/" or space
//
// Status handling (RFC 9309 section 2.3.1): 2xx parses the file, 4xx allows
// everything, 5xx or an unreachable server (status 0) disallows everything.
// Matching: the longest pattern wins, Allow wins a tie, "*" matches any run of
// characters and a trailing "$" anchors the end. "/robots.txt" is always allowed.

export const productToken = (ua) =>
  String(ua ?? "").trim().split(/[\/\s]/)[0].toLowerCase();

const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** Percent-encoding normalisation so "/%62ar" and "/bar" compare equal. */
function normalisePath(s) {
  let out = "";
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (code > 0x7e || code < 0x21) {
      out += encodeURIComponent(ch);
    } else out += ch;
  }
  return out.replace(/%([0-9a-fA-F]{2})/g, (m, hex) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(c) ? c : "%" + hex.toUpperCase();
  });
}

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? "").split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value === "*" ? "*" : productToken(value));
      lastWasAgent = true;
      continue;
    }
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    lastWasAgent = false;
    if ((key === "allow" || key === "disallow") && current && value) {
      current.rules.push({ allow: key === "allow", pattern: normalisePath(value) });
    }
  }
  return { groups, sitemaps };
}

function toRegExp(pattern) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

function matcher(rules) {
  const compiled = rules.map((r) => ({ ...r, re: toRegExp(r.pattern), length: r.pattern.length }));
  return (pathAndQuery) => {
    const path = normalisePath(pathAndQuery || "/");
    if (path === "/robots.txt") return true;
    let best = null;
    for (const rule of compiled) {
      if (!rule.re.test(path)) continue;
      if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule;
    }
    return best ? best.allow : true;
  };
}

export function robotsFor({ status, body }, userAgent) {
  // 3xx here means the redirects ran out (more than five hops): RFC 9309 treats that as unavailable.
  if (status >= 300 && status < 500) {
    return { isAllowed: () => true, sitemaps: [], note: `robots.txt returned ${status}, so everything is allowed` };
  }
  if (!(status >= 200 && status < 300)) {
    return {
      isAllowed: (p) => normalisePath(p) === "/robots.txt",
      sitemaps: [],
      note: status ? `robots.txt returned ${status}, so nothing is crawled` : "robots.txt was unreachable, so nothing is crawled",
    };
  }
  const parsed = parseRobots(body);
  const token = productToken(userAgent);
  let picked = parsed.groups.filter((g) => g.agents.includes(token));
  if (!picked.length) picked = parsed.groups.filter((g) => g.agents.includes("*"));
  return { isAllowed: matcher(picked.flatMap((g) => g.rules)), sitemaps: parsed.sitemaps, note: "" };
}
