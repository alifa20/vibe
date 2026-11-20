import express from 'express';

import * as inv from './invoices.mjs';
import * as views from './views.mjs';
import { safeNext } from './auth.mjs';
import { validateClient, validateInvoice, validateLine, validatePayment, validateSettings } from './validate.mjs';

const html = (res, body, status = 200) => res.status(status).type('html').send(body);

/** Login and logout. Mounted before the auth gate. */
export function authRoutes({ auth }) {
  const r = express.Router();

  r.get('/login', (req, res) => {
    if (auth.isAuthed(req)) return res.redirect(303, safeNext(req.query.next));
    html(res, views.loginPage({ next: safeNext(req.query.next) }));
  });

  r.post('/login', (req, res) => {
    const next = safeNext(req.body?.next);
    const wait = auth.lockedFor(req.ip);
    if (wait) {
      res.set('Retry-After', String(wait));
      return html(res, views.loginPage({ next, error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minutes.` }), 429);
    }
    if (!auth.passwordMatches(req.body?.password)) {
      auth.recordFailure(req.ip);
      return html(res, views.loginPage({ next, error: 'That password is not right.' }), 401);
    }
    auth.clearFailures(req.ip);
    auth.login(req, res);
    res.redirect(303, next);
  });

  r.post('/logout', (req, res) => {
    auth.logout(req, res);
    res.redirect(303, '/login');
  });

  return r;
}

/** Everything behind the login. */
export function adminRoutes({ db, clock }) {
  const r = express.Router();
  const now = () => clock.now();
  const today = () => inv.today(db, now());
  const clientIds = () => inv.listClients(db).map((c) => c.id);

  const load = (req) => {
    const id = Number(req.params.id);
    const found = Number.isInteger(id) ? inv.getInvoice(db, id) : null;
    if (!found) throw new inv.InvoiceError('No such invoice.', 404);
    return found;
  };
  const requireDraft = (found) => {
    if (found.status !== 'draft') throw new inv.InvoiceError('This invoice has been sent and can no longer be edited.');
    return found;
  };

  /* dashboard */
  r.get('/', (req, res) => {
    const t = today();
    html(res, views.dashboardPage({ dash: inv.dashboard(db, t), today: t }));
  });

  /* settings */
  r.get('/settings', (req, res) => {
    html(res, views.settingsPage({ values: inv.getSettings(db), saved: req.query.saved === '1' }));
  });
  r.post('/settings', (req, res) => {
    const v = validateSettings(req.body ?? {});
    if (!v.ok) return html(res, views.settingsPage({ values: v.values, errors: v.errors }), 400);
    inv.saveSettings(db, v.values);
    res.redirect(303, '/settings?saved=1');
  });

  /* clients */
  r.get('/clients', (req, res) => {
    html(res, views.clientsPage({ clients: inv.listClients(db) }));
  });
  r.post('/clients', (req, res) => {
    const v = validateClient(req.body ?? {});
    if (!v.ok) return html(res, views.clientsPage({ clients: inv.listClients(db), values: v.values, errors: v.errors }), 400);
    inv.createClient(db, v.values, now());
    res.redirect(303, '/clients');
  });
  const loadClient = (req) => {
    const c = inv.getClient(db, Number(req.params.id));
    if (!c) throw new inv.InvoiceError('No such client.', 404);
    return c;
  };
  const clientUsed = (id) => inv.listClients(db).find((c) => c.id === id)?.invoice_count > 0;
  r.get('/clients/:id/edit', (req, res) => {
    const client = loadClient(req);
    html(res, views.clientEditPage({ client, values: client, canDelete: !clientUsed(client.id) }));
  });
  r.post('/clients/:id', (req, res) => {
    const client = loadClient(req);
    const v = validateClient(req.body ?? {});
    if (!v.ok) {
      return html(res, views.clientEditPage({ client, values: v.values, errors: v.errors, canDelete: !clientUsed(client.id) }), 400);
    }
    inv.updateClient(db, client.id, v.values);
    res.redirect(303, '/clients');
  });
  r.post('/clients/:id/delete', (req, res) => {
    inv.deleteClient(db, loadClient(req).id);
    res.redirect(303, '/clients');
  });

  /* invoices: create */
  r.get('/invoices/new', (req, res) => {
    const s = inv.getSettings(db);
    const clients = inv.listClients(db);
    html(res, views.invoiceNewPage({ clients, values: { client_id: req.query.client || '', currency: s.default_currency } }));
  });
  r.post('/invoices', (req, res) => {
    const v = validateInvoice(req.body ?? {}, clientIds());
    if (!v.ok) return html(res, views.invoiceNewPage({ clients: inv.listClients(db), values: v.values, errors: v.errors }), 400);
    const id = inv.createInvoice(db, v.values, now());
    res.redirect(303, `/invoices/${id}`);
  });

  /* invoices: view or edit */
  r.get('/invoices/:id', (req, res) => {
    const found = load(req);
    if (found.status === 'draft') return html(res, views.invoiceEditPage({ inv: found, clients: inv.listClients(db) }));
    html(res, views.invoiceViewPage({ inv: found, today: today() }));
  });
  r.post('/invoices/:id', (req, res) => {
    const found = requireDraft(load(req));
    const v = validateInvoice(req.body ?? {}, clientIds());
    if (!v.ok) {
      return html(res, views.invoiceEditPage({ inv: found, clients: inv.listClients(db), header: v.values, headerErrors: v.errors }), 400);
    }
    inv.updateDraft(db, found.id, v.values, now());
    res.redirect(303, `/invoices/${found.id}`);
  });

  /* lines */
  r.post('/invoices/:id/lines', (req, res) => {
    const found = requireDraft(load(req));
    const v = validateLine(req.body ?? {}, found.currency);
    if (!v.ok) {
      return html(res, views.invoiceEditPage({ inv: found, clients: inv.listClients(db), line: v.raw, lineErrors: v.errors }), 400);
    }
    inv.addLine(db, found.id, v.values);
    res.redirect(303, `/invoices/${found.id}`);
  });
  const findLine = (found, req) => {
    const line = found.lines.find((l) => l.id === Number(req.params.lineId));
    if (!line) throw new inv.InvoiceError('No such line.', 404);
    return line;
  };
  r.get('/invoices/:id/lines/:lineId/edit', (req, res) => {
    const found = requireDraft(load(req));
    const line = findLine(found, req);
    html(res, views.lineEditPage({ inv: found, lineId: line.id, raw: views.lineToRaw(line, found.currency) }));
  });
  r.post('/invoices/:id/lines/:lineId', (req, res) => {
    const found = requireDraft(load(req));
    const line = findLine(found, req);
    const v = validateLine(req.body ?? {}, found.currency);
    if (!v.ok) return html(res, views.lineEditPage({ inv: found, lineId: line.id, raw: v.raw, errors: v.errors }), 400);
    inv.updateLine(db, found.id, line.id, v.values);
    res.redirect(303, `/invoices/${found.id}`);
  });
  r.post('/invoices/:id/lines/:lineId/delete', (req, res) => {
    const found = requireDraft(load(req));
    inv.deleteLine(db, found.id, findLine(found, req).id);
    res.redirect(303, `/invoices/${found.id}`);
  });

  /* lifecycle: each step has a confirmation page that states the consequence */
  const allowed = {
    send: (s) => s === 'draft',
    delete: (s) => s === 'draft',
    pay: (s) => s === 'sent',
    void: (s) => s === 'sent' || s === 'paid',
  };
  for (const action of Object.keys(allowed)) {
    r.get(`/invoices/:id/${action}`, (req, res) => {
      const found = load(req);
      if (!allowed[action](found.status)) return res.redirect(303, `/invoices/${found.id}`);
      html(res, views.confirmPage({ inv: found, action, values: { paid_date: today(), payment_method: '' } }));
    });
  }
  r.post('/invoices/:id/send', (req, res) => {
    const found = load(req);
    inv.sendInvoice(db, found.id, now());
    res.redirect(303, `/invoices/${found.id}`);
  });
  r.post('/invoices/:id/delete', (req, res) => {
    inv.deleteInvoice(db, load(req).id);
    res.redirect(303, '/');
  });
  r.post('/invoices/:id/pay', (req, res) => {
    const found = load(req);
    const v = validatePayment(req.body ?? {}, found.issue_date);
    if (!v.ok) return html(res, views.confirmPage({ inv: found, action: 'pay', values: v.values, errors: v.errors }), 400);
    inv.recordPayment(db, found.id, v.values, now());
    res.redirect(303, `/invoices/${found.id}`);
  });
  r.post('/invoices/:id/void', (req, res) => {
    const found = load(req);
    inv.voidInvoice(db, found.id, now());
    res.redirect(303, `/invoices/${found.id}`);
  });

  /* print */
  r.get('/invoices/:id/print', (req, res) => {
    const found = load(req);
    html(res, views.printPage({ inv: found, settings: inv.getSettings(db), today: today() }));
  });

  return r;
}
