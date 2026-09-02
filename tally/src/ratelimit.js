'use strict';

const config = require('./config');

/**
 * In-memory sliding-window limiter, keyed by "formId:ip". Deliberately not
 * persisted: a restart clearing the window is an acceptable trade for having
 * zero moving parts on a single-VPS deploy.
 */
const hits = new Map();

function prune(now) {
  for (const [key, stamps] of hits) {
    const fresh = stamps.filter((t) => now - t < config.rateLimit.windowMs);
    if (fresh.length === 0) hits.delete(key);
    else hits.set(key, fresh);
  }
}

let lastPrune = Date.now();

/**
 * Records an attempt and reports whether it should be allowed.
 * @returns {{ allowed: boolean, retryAfterSeconds: number }}
 */
function check(formId, ip) {
  const now = Date.now();
  if (now - lastPrune > config.rateLimit.windowMs) {
    prune(now);
    lastPrune = now;
  }

  const key = `${formId}:${ip}`;
  const window = (hits.get(key) || []).filter((t) => now - t < config.rateLimit.windowMs);

  if (window.length >= config.rateLimit.max) {
    const oldest = window[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((config.rateLimit.windowMs - (now - oldest)) / 1000)
    );
    hits.set(key, window);
    return { allowed: false, retryAfterSeconds };
  }

  window.push(now);
  hits.set(key, window);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Used when a submission is rejected before it counted as a real attempt. */
function refund(formId, ip) {
  const key = `${formId}:${ip}`;
  const window = hits.get(key);
  if (window && window.length) {
    window.pop();
    if (window.length === 0) hits.delete(key);
  }
}

module.exports = { check, refund };
