import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Resolve a possibly-relative path against the project root. */
export const fromRoot = (p) => (isAbsolute(p) ? p : join(ROOT, p));

/** Minimal .env reader. Existing process.env values always win. */
export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const q = val[0];
    if ((q === '"' || q === "'") && val.endsWith(q) && val.length > 1) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function slugify(input) {
  const s = String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'link';
}

/**
 * Read links.json and normalise it.
 * Every link gets a stable `slug` (the tracking key) and a `host` for the margin.
 * Explicit "slug" in the JSON pins the key so renaming a title keeps its history.
 */
export function loadSite(file = join(ROOT, 'links.json')) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const warnings = [];
  const seen = new Set();
  const links = [];

  for (const [i, l] of (raw.links ?? []).entries()) {
    if (!l || l.hidden) continue;
    if (!l.title || !l.url) {
      warnings.push(`links[${i}]: needs both "title" and "url" — skipped`);
      continue;
    }
    let url;
    try {
      url = new URL(l.url);
    } catch {
      warnings.push(`links[${i}] "${l.title}": "${l.url}" is not a valid URL — skipped`);
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') {
      warnings.push(`links[${i}] "${l.title}": only http, https and mailto are allowed — skipped`);
      continue;
    }

    const base = slugify(l.slug || l.title);
    let slug = base;
    for (let n = 2; seen.has(slug); n++) slug = `${base}-${n}`;
    if (slug !== base && !l.slug) {
      warnings.push(`links[${i}] "${l.title}": duplicate slug, using "${slug}". Pin it with "slug" to keep click history stable.`);
    }
    seen.add(slug);

    links.push({
      title: String(l.title),
      url: l.url,
      emoji: l.emoji ? String(l.emoji) : '',
      slug,
      host: url.protocol === 'mailto:' ? 'email' : url.host.replace(/^www\./, ''),
    });
  }

  return {
    name: raw.name || 'Your name',
    bio: raw.bio || '',
    avatar: raw.avatar || '/avatar.svg',
    siteUrl: (process.env.SITE_URL || raw.siteUrl || '').replace(/\/+$/, ''),
    links,
    warnings,
  };
}

/** Salt for the daily visitor hash. Random per-boot if unset, which is fine but resets counts. */
export function visitorSalt() {
  if (!process.env.HASH_SALT) {
    process.env.HASH_SALT = randomBytes(24).toString('hex');
    return { salt: process.env.HASH_SALT, ephemeral: true };
  }
  return { salt: process.env.HASH_SALT, ephemeral: false };
}
