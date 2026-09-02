import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { config, limits } from './src/config.js';
import {
  counts,
  createTestimonial,
  deleteTestimonial,
  getTestimonial,
  listAll,
  listApproved,
  setApproved,
  wallStats,
} from './src/db.js';
import { AvatarError, deleteAvatar, fetchAvatar, storeAvatar } from './src/avatar.js';
import { renderAdmin } from './src/pages/admin.js';
import { renderSubmit, renderThanks } from './src/pages/submit.js';
import { renderWall } from './src/pages/wall.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const publicOrigin = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* ---------------------------------------------------------------- uploads */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 16, fieldSize: 64 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype && !file.mimetype.startsWith('image/')) {
      cb(new AvatarError('Your photo must be an image file.'));
      return;
    }
    cb(null, true);
  },
});

/* ------------------------------------------------------------- rate limit */

const WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map();

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, hits] of buckets) {
    const live = hits.filter((time) => time > cutoff);
    if (live.length) buckets.set(key, live);
    else buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

const recentHits = (ip) => {
  const cutoff = Date.now() - WINDOW_MS;
  const hits = (buckets.get(ip) ?? []).filter((time) => time > cutoff);
  buckets.set(ip, hits);
  return hits;
};

/** Checked before doing any work. Only *accepted* submissions count towards the
 *  limit, so someone who mistypes the form five times is not locked out. */
function atRateLimit(ip) {
  if (config.submitRateLimit <= 0) return false;
  return recentHits(ip).length >= config.submitRateLimit;
}

function recordSubmission(ip) {
  if (config.submitRateLimit <= 0) return;
  recentHits(ip).push(Date.now());
}

/* ------------------------------------------------------------ admin auth */

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function requireAdmin(req, res, next) {
  if (!config.admin.password) {
    res
      .status(503)
      .type('text/plain')
      .send('ADMIN_PASSWORD is not set. Add it to .env and restart the server.');
    return;
  }

  const [scheme, encoded] = (req.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (safeEqual(user, config.admin.user) && safeEqual(password, config.admin.password)) {
      res.set('Cache-Control', 'no-store');
      next();
      return;
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Moderation", charset="UTF-8"');
  res.status(401).type('text/plain').send('Authentication required.');
}

/**
 * Browsers replay cached basic-auth credentials on cross-site form posts, so the
 * admin mutations check that the request actually came from our own pages.
 */
function sameOriginOnly(req, res, next) {
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin') {
    res.status(403).type('text/plain').send('Cross-site request blocked.');
    return;
  }
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    res.status(403).type('text/plain').send('Cross-site request blocked.');
    return;
  }
  next();
}

/* ---------------------------------------------------------- public pages */

app.get('/', (req, res) => res.redirect(302, '/wall'));

app.get('/wall', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.type('html').send(
    renderWall({ testimonials: listApproved({ limit: 300 }), stats: wallStats() }),
  );
});

app.get('/submit', (req, res) => {
  res.type('html').send(req.query.sent === '1' ? renderThanks() : renderSubmit());
});

app.post('/submit', (req, res, next) => {
  upload.single('avatar')(req, res, (uploadError) => {
    handleSubmit(req, res, uploadError).catch(next);
  });
});

async function handleSubmit(req, res, uploadError) {
  const body = req.body ?? {};
  const values = {
    name: String(body.name ?? '').slice(0, limits.name * 2),
    role: String(body.role ?? '').slice(0, limits.role * 2),
    text: String(body.text ?? '').slice(0, limits.text * 2),
    rating: String(body.rating ?? ''),
    avatar_url: String(body.avatar_url ?? '').slice(0, 2048),
  };

  const fail = (message) =>
    res.status(400).type('html').send(renderSubmit({ values, error: message }));

  if (uploadError) {
    if (uploadError.code === 'LIMIT_FILE_SIZE') {
      return fail(`That photo is larger than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`);
    }
    if (uploadError instanceof AvatarError) return fail(uploadError.message);
    throw uploadError;
  }

  // Bots fill in every field they can find; humans never see this one.
  if (String(body.website ?? '').trim()) {
    return res.redirect(303, '/submit?sent=1');
  }

  if (atRateLimit(req.ip)) {
    return fail('You have submitted several testimonials already. Please try again later.');
  }

  const name = values.name.trim();
  const role = values.role.trim();
  const text = values.text.trim();
  const rating = Number.parseInt(values.rating, 10);

  if (!name) return fail('Please tell us your name.');
  if (name.length > limits.name) return fail(`Names are limited to ${limits.name} characters.`);
  if (role.length > limits.role) return fail(`Role is limited to ${limits.role} characters.`);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail('Please choose a star rating.');
  if (text.length < limits.textMin) return fail(`Your testimonial needs at least ${limits.textMin} characters.`);
  if (text.length > limits.text) return fail(`Testimonials are limited to ${limits.text} characters.`);

  let avatar = null;
  try {
    if (req.file?.buffer?.length) {
      avatar = await storeAvatar(req.file.buffer);
    } else if (values.avatar_url.trim()) {
      avatar = await fetchAvatar(values.avatar_url);
    }
  } catch (error) {
    if (error instanceof AvatarError) return fail(error.message);
    throw error;
  }

  createTestimonial({ name, role, avatar, rating, text, sourceIp: req.ip ?? null });
  recordSubmission(req.ip);
  res.redirect(303, '/submit?sent=1');
}

/* -------------------------------------------------------- embed + JSON API */

const allowAnyOrigin = (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
};

app.get('/api/testimonials', allowAnyOrigin, (req, res) => {
  const limit = clamp(Number.parseInt(req.query.limit, 10) || 60, 1, 300);
  const minRating = clamp(Number.parseInt(req.query.minRating, 10) || 1, 1, 5);
  const origin = publicOrigin(req);
  const stats = wallStats();

  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    site: config.siteName,
    count: stats.count,
    average: Math.round(stats.average * 10) / 10,
    testimonials: listApproved({ limit, minRating }).map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role || null,
      rating: row.rating,
      text: row.text,
      avatar: row.avatar ? `${origin}/uploads/${row.avatar}` : null,
      date: row.created_at,
    })),
  });
});

app.get('/embed.js', allowAnyOrigin, (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.type('application/javascript').sendFile('embed.js', { root: config.publicDir });
});

app.use(
  '/uploads',
  allowAnyOrigin,
  express.static(config.uploadsDir, {
    index: false,
    dotfiles: 'deny',
    maxAge: '365d',
    immutable: true,
  }),
);

/* ---------------------------------------------------------------- admin */

app.get('/admin', requireAdmin, (req, res) => {
  const filter = ['pending', 'approved', 'all'].includes(req.query.filter)
    ? req.query.filter
    : 'pending';

  res.type('html').send(
    renderAdmin({
      rows: listAll(filter),
      filter,
      totals: counts(),
      origin: publicOrigin(req),
      flash: typeof req.query.done === 'string' ? req.query.done : '',
    }),
  );
});

const adminAction = express.urlencoded({ extended: false, limit: '16kb' });

const backTo = (req, res, message) => {
  const filter = ['pending', 'approved', 'all'].includes(req.body?.filter)
    ? req.body.filter
    : 'pending';
  res.redirect(303, `/admin?filter=${filter}&done=${encodeURIComponent(message)}`);
};

app.post('/admin/:id/approve', requireAdmin, sameOriginOnly, adminAction, (req, res) => {
  const changed = setApproved(Number(req.params.id), true);
  backTo(req, res, changed ? 'Testimonial approved - it is live on the wall.' : 'Not found.');
});

app.post('/admin/:id/unapprove', requireAdmin, sameOriginOnly, adminAction, (req, res) => {
  const changed = setApproved(Number(req.params.id), false);
  backTo(req, res, changed ? 'Testimonial unpublished.' : 'Not found.');
});

app.post('/admin/:id/delete', requireAdmin, sameOriginOnly, adminAction, async (req, res) => {
  const id = Number(req.params.id);
  const row = getTestimonial(id);
  const changed = deleteTestimonial(id);
  if (changed && row?.avatar) await deleteAvatar(row.avatar);
  backTo(req, res, changed ? 'Testimonial deleted.' : 'Not found.');
});

/* --------------------------------------------------------------- system */

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

app.use((req, res) => res.status(404).type('text/plain').send('Not found.'));

app.use((error, req, res, next) => {
  console.error('[senja]', error);
  if (res.headersSent) return next(error);
  res.status(500).type('text/plain').send('Something went wrong.');
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[senja] listening on http://${config.host}:${config.port}`);
  if (!config.admin.password) {
    console.warn('[senja] ADMIN_PASSWORD is unset - /admin will refuse to load until you set it.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
