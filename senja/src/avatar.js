import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';

export class AvatarError extends Error {}

/**
 * Resize any supported image to a square avatar and write it to the uploads dir.
 * Returns the stored filename.
 */
export async function storeAvatar(buffer) {
  let output;
  try {
    output = await sharp(buffer, { failOn: 'error', limitInputPixels: 50e6 })
      .rotate() // honour EXIF orientation before cropping
      .resize(config.avatarSize, config.avatarSize, {
        fit: 'cover',
        position: sharp.strategy.attention,
        withoutEnlargement: false,
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new AvatarError('That file could not be read as an image.');
  }

  const filename = `${crypto.randomUUID()}.webp`;
  await fs.writeFile(path.join(config.uploadsDir, filename), output);
  return filename;
}

export async function deleteAvatar(filename) {
  if (!filename || filename.includes('/') || filename.includes('\\')) return;
  await fs.rm(path.join(config.uploadsDir, filename), { force: true });
}

/**
 * Download an avatar from a user-supplied URL.
 *
 * Every hop is checked against private address ranges before the request is made,
 * redirects are followed manually so they cannot escape that check, and the body is
 * capped as it streams so a hostile server cannot exhaust memory.
 */
export async function fetchAvatar(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AvatarError('That avatar URL is not valid.');
  }

  const seen = new Set();
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new AvatarError('Avatar URLs must start with http:// or https://.');
    }
    if (seen.has(url.href)) throw new AvatarError('That avatar URL redirects in a loop.');
    seen.add(url.href);

    await assertPublicHost(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'image/*', 'user-agent': 'senja-testimonials/1.0' },
      });
    } catch {
      throw new AvatarError('We could not reach that avatar URL.');
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    if (!response.ok) {
      throw new AvatarError(`That avatar URL returned HTTP ${response.status}.`);
    }

    const type = response.headers.get('content-type') || '';
    if (type && !type.startsWith('image/')) {
      throw new AvatarError('That URL does not point at an image.');
    }
    return storeAvatar(await readCapped(response, config.maxUploadBytes));
  }

  throw new AvatarError('That avatar URL redirected too many times.');
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AvatarError('That image is too large.');
  }

  const chunks = [];
  let total = 0;
  // Throwing out of the loop cancels the underlying stream for us; calling
  // response.body.cancel() here would fail because the iterator holds the lock.
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw new AvatarError('That image is too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

async function assertPublicHost(hostname) {
  if (config.allowPrivateAvatarHosts) return;

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      throw new AvatarError('We could not resolve that avatar URL.');
    }
  }

  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new AvatarError('That avatar URL points at a private address.');
  }
}

export function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) return isPrivateV6(address);
  return true; // unparseable: treat as unsafe
}

function isPrivateV4(address) {
  const [a, b] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateV6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);

  const head = normalized.split(':')[0];
  if (/^f[cd]/.test(head)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(head)) return true; // link-local fe80::/10
  if (/^ff/.test(head)) return true; // multicast
  return false;
}
