import express from 'express';
import { codes, scans, slugError, normaliseTarget } from '../db.js';
import { listPage, detailPage, errorPage } from '../views/admin.js';

export function createAdminRouter({ baseUrl }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '32kb' }));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const notFound = (res) =>
    res.status(404).type('html').send(errorPage({
      status: 404,
      title: 'Code not found',
      message: 'That dynamic code no longer exists.'
    }));

  router.get('/', (req, res) => {
    res.type('html').send(listPage({
      rows: codes.list(),
      stats: codes.stats(),
      baseUrl: baseUrl(req),
      ok: req.query.ok,
      err: typeof req.query.err === 'string' ? req.query.err.slice(0, 200) : null,
      form: {
        target: typeof req.query.target === 'string' ? req.query.target.slice(0, 2000) : '',
        label: typeof req.query.label === 'string' ? req.query.label.slice(0, 200) : '',
        slug: typeof req.query.slug === 'string' ? req.query.slug.slice(0, 64) : ''
      }
    }));
  });

  router.post('/codes', (req, res) => {
    const label = String(req.body.label || '').trim().slice(0, 200);
    const wanted = String(req.body.slug || '').trim();
    const { target, error } = normaliseTarget(req.body.target);

    const back = (message) => {
      const params = new URLSearchParams({ err: message, label });
      if (req.body.target) params.set('target', String(req.body.target).slice(0, 2000));
      if (wanted) params.set('slug', wanted);
      return res.redirect(303, `/admin?${params}`);
    };

    if (error) return back(error);

    let slug;
    if (wanted) {
      const bad = slugError(wanted);
      if (bad) return back(bad);
      if (codes.bySlug(wanted)) return back(`The slug "${wanted}" is already taken.`);
      slug = wanted;
    } else {
      slug = codes.uniqueSlug();
    }

    const created = codes.create({ slug, label, target });
    return res.redirect(303, `/admin/codes/${created.id}?ok=created`);
  });

  router.get('/codes/:id', (req, res) => {
    const code = codes.byId(Number(req.params.id));
    if (!code) return notFound(res);

    res.type('html').send(detailPage({
      code,
      recent: scans.recent(code.id, 50),
      daily: scans.daily(code.id),
      totals: codes.totals(code.id),
      baseUrl: baseUrl(req),
      ok: req.query.ok,
      err: typeof req.query.err === 'string' ? req.query.err.slice(0, 200) : null
    }));
  });

  router.post('/codes/:id', (req, res) => {
    const id = Number(req.params.id);
    const code = codes.byId(id);
    if (!code) return notFound(res);

    const back = (message) => res.redirect(303, `/admin/codes/${id}?err=${encodeURIComponent(message)}`);

    const label = String(req.body.label || '').trim().slice(0, 200);
    const slug = String(req.body.slug || '').trim();
    const { target, error } = normaliseTarget(req.body.target);
    if (error) return back(error);

    const bad = slugError(slug);
    if (bad) return back(bad);

    const clash = codes.bySlug(slug);
    if (clash && clash.id !== id) return back(`The slug "${slug}" is already taken.`);

    codes.update({ id, slug, label, target, active: req.body.active === '1' });
    return res.redirect(303, `/admin/codes/${id}?ok=updated`);
  });

  router.post('/codes/:id/delete', (req, res) => {
    const code = codes.byId(Number(req.params.id));
    if (!code) return notFound(res);
    codes.remove(code.id);
    return res.redirect(303, '/admin?ok=deleted');
  });

  router.post('/codes/:id/scans/clear', (req, res) => {
    const code = codes.byId(Number(req.params.id));
    if (!code) return notFound(res);
    scans.clear(code.id);
    return res.redirect(303, `/admin/codes/${code.id}?ok=cleared`);
  });

  return router;
}
