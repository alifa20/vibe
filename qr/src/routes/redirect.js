import express from 'express';
import { codes, scans } from '../db.js';
import { errorPage } from '../views/admin.js';

export const redirectRouter = express.Router();

redirectRouter.get('/r/:slug', (req, res) => {
  const code = codes.bySlug(req.params.slug);

  // A redirect must never be cached: the whole point is that the target can change.
  res.set('Cache-Control', 'no-store, max-age=0');

  if (!code) {
    return res
      .status(404)
      .type('html')
      .send(errorPage({
        status: 404,
        title: 'Unknown code',
        message: 'This short link does not exist. It may have been deleted.'
      }));
  }

  if (!code.active) {
    return res
      .status(410)
      .type('html')
      .send(errorPage({
        status: 410,
        title: 'Code disabled',
        message: 'This code has been turned off by its owner.'
      }));
  }

  if (req.method === 'GET') {
    try {
      scans.log(code.id, req.get('user-agent'), req.get('referer'));
    } catch (err) {
      // Never let analytics break the redirect.
      console.error('scan log failed:', err.message);
    }
  }

  return res.redirect(302, code.target);
});
