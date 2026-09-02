'use strict';

const crypto = require('crypto');
const config = require('./config');

const COOKIE_NAME = 'tally_admin';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Constant-time comparison that tolerates differing lengths. */
function tokenMatches(candidate) {
  if (typeof candidate !== 'string') return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(config.adminToken).digest();
  return crypto.timingSafeEqual(a, b);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: !config.insecureCookies,
    signed: true,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

function login(res) {
  res.cookie(COOKIE_NAME, 'ok', cookieOptions());
}

function logout(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

function isAuthed(req) {
  return req.signedCookies?.[COOKIE_NAME] === 'ok';
}

/** Gate for every /admin route except the login page itself. */
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();

  // Allow a one-shot ?token=... so a bookmark or curl call can get in.
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  if (queryToken && tokenMatches(queryToken)) {
    login(res);
    const clean = req.originalUrl.replace(/([?&])token=[^&]*(&|$)/, '$1').replace(/[?&]$/, '');
    return res.redirect(clean || '/admin');
  }

  const next_ = encodeURIComponent(req.originalUrl.split('?')[0]);
  return res.redirect(`/admin/login?next=${next_}`);
}

module.exports = { COOKIE_NAME, tokenMatches, login, logout, isAuthed, requireAuth };
