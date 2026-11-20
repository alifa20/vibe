// URL helpers shared by the crawler and the audits.
//
//   normaliseUrl(url)        -> string  lowercased scheme and host, no fragment, no default port
//   resolveLink(href, base)  -> string | null  absolute, normalised http(s) URL, or null to skip
//   sameOrigin(a, b)         -> boolean
//   isHttp(url)              -> boolean

const SKIPPED = /^\s*(mailto|tel|javascript|data):/i;

/** WHATWG URL already lowercases scheme and host and drops default ports. */
export function normaliseUrl(input) {
  const u = new URL(input);
  u.hash = "";
  return u.href;
}

export function resolveLink(href, base) {
  const raw = String(href ?? "").trim();
  if (!raw || raw.startsWith("#") || SKIPPED.test(raw)) return null;
  let u;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  return u.href;
}

export function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function isHttp(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
