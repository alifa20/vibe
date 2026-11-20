import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startApp, idFrom, PASSWORD } from './helpers.mjs';

async function withApp(fn, opts) {
  const app = await startApp(opts);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function clientAndDraft(app, { currency = 'USD' } = {}) {
  await app.post('/clients', { name: 'Globex', email: 'ap@globex.test', address: '9 Old Rd' });
  const clientId = app.db.prepare('SELECT id FROM clients ORDER BY id DESC').get().id;
  const res = await app.post('/invoices', { client_id: String(clientId), currency, due_date: '', notes: '' });
  assert.equal(res.status, 303);
  return { clientId, id: idFrom(res.location) };
}

test('unauthenticated pages redirect to login', () =>
  withApp(async (app) => {
    for (const path of ['/', '/clients', '/settings', '/invoices/new', '/invoices/1', '/invoices/1/print']) {
      const res = await app.get(path);
      assert.equal(res.status, 303, path);
      assert.match(res.location, /^\/login\?next=/, path);
    }
    const post = await app.post('/clients', { name: 'x' });
    assert.equal(post.status, 401);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 0);
    assert.equal((await app.get('/login')).status, 200);
  }));

test('login sets an httpOnly session cookie; a wrong password does not', () =>
  withApp(async (app) => {
    const bad = await app.post('/login', { password: 'nope' });
    assert.equal(bad.status, 401);
    assert.match(bad.text, /not right/);
    const ok = await app.post('/login', { password: PASSWORD, next: '/clients' });
    assert.equal(ok.status, 303);
    assert.equal(ok.location, '/clients');
    assert.match(ok.headers.get('set-cookie'), /inv_session=\d+\.[0-9a-f]{64}; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax/);
    assert.equal((await app.get('/')).status, 200);
  }));

test('login never redirects off-site', () =>
  withApp(async (app) => {
    const res = await app.post('/login', { password: PASSWORD, next: '//evil.example/' });
    assert.equal(res.location, '/');
  }));

test('the session expires', () =>
  withApp(async (app) => {
    await app.login();
    assert.equal((await app.get('/')).status, 200);
    app.clock.t += 13 * 60 * 60 * 1000;
    assert.equal((await app.get('/')).status, 303);
  }));

test('repeated failed logins lock the IP out, even for the right password', () =>
  withApp(async (app) => {
    for (let i = 0; i < 8; i += 1) assert.equal((await app.post('/login', { password: 'wrong' })).status, 401);
    const locked = await app.login();
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    app.clock.t += 16 * 60 * 1000;
    assert.equal((await app.login()).status, 303);
  }));

test('cross-site POSTs are rejected', () =>
  withApp(async (app) => {
    await app.login();
    const cross = await app.post('/clients', { name: 'Evil' }, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(cross.status, 403);
    const badOrigin = await app.post('/clients', { name: 'Evil' }, { headers: { origin: 'https://evil.example' } });
    assert.equal(badOrigin.status, 403);
    const loginCross = await app.post('/login', { password: PASSWORD }, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(loginCross.status, 403);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 0);
  }));

test('a client, then a draft with two lines, shows correct totals in the editor', () =>
  withApp(async (app) => {
    await app.login();
    const { id } = await clientAndDraft(app);
    await app.post(`/invoices/${id}/lines`, { description: 'Design', quantity: '3', unit_price: '33.33', tax_rate: '10' });
    await app.post(`/invoices/${id}/lines`, { description: 'Hosting', quantity: '1', unit_price: '0.01', tax_rate: '10' });
    const page = await app.get(`/invoices/${id}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Design/);
    assert.match(page.text, /Subtotal<\/th><td class="num">\$100\.00/);
    assert.match(page.text, /Tax 10%/);
    assert.match(page.text, /\$10\.00/);
    assert.match(page.text, /Total<\/th><td class="num">\$110\.00/);
  }));

test('invalid lines re-render with field errors and save nothing', () =>
  withApp(async (app) => {
    await app.login();
    const { id } = await clientAndDraft(app);
    const negative = await app.post(`/invoices/${id}/lines`, { description: 'x', quantity: '-1', unit_price: '5', tax_rate: '0' });
    assert.equal(negative.status, 400);
    assert.match(negative.text, /Quantity cannot be negative/);
    assert.match(negative.text, /value="-1"/);
    const taxy = await app.post(`/invoices/${id}/lines`, { description: 'x', quantity: '1', unit_price: '5', tax_rate: '120' });
    assert.equal(taxy.status, 400);
    assert.match(taxy.text, /Tax rate must be between 0 and 100%/);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM invoice_lines').get().n, 0);
  }));

test('an unknown currency re-renders the form and creates nothing', () =>
  withApp(async (app) => {
    await app.login();
    await app.post('/clients', { name: 'Globex' });
    const clientId = app.db.prepare('SELECT id FROM clients').get().id;
    const res = await app.post('/invoices', { client_id: String(clientId), currency: 'XYZ' });
    assert.equal(res.status, 400);
    assert.match(res.text, /three-letter ISO currency code/);
    assert.match(res.text, /aria-invalid="true"/);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n, 0);
  }));

test('a client with an empty name is rejected and the input is kept', () =>
  withApp(async (app) => {
    await app.login();
    const res = await app.post('/clients', { name: '', email: 'keep@me.test' });
    assert.equal(res.status, 400);
    assert.match(res.text, /Name is required/);
    assert.match(res.text, /value="keep@me.test"/);
  }));

test('send goes through a confirmation page, then the invoice is read-only', () =>
  withApp(async (app) => {
    await app.login();
    const { id } = await clientAndDraft(app);
    await app.post(`/invoices/${id}/lines`, { description: 'Work', quantity: '1.5', unit_price: '120', tax_rate: '0' });
    const confirm = await app.get(`/invoices/${id}/send`);
    assert.match(confirm.text, /assigns the next invoice number/);
    assert.match(confirm.text, /cannot be deleted/);
    const sent = await app.post(`/invoices/${id}/send`);
    assert.equal(sent.status, 303);
    const view = await app.get(`/invoices/${id}`);
    assert.match(view.text, /INV-2026-0001/);
    assert.match(view.text, /\$180\.00/);
    assert.match(view.text, /<strong class="status-text">sent<\/strong>/);
    assert.doesNotMatch(view.text, /\/lines\/\d+\/edit/);
    assert.doesNotMatch(view.text, /Delete draft/);
    assert.doesNotMatch(view.text, /<form method="post" action="\/invoices\/\d+\/lines"/);

    const edit = await app.post(`/invoices/${id}/lines`, { description: 'More', quantity: '1', unit_price: '1', tax_rate: '0' });
    assert.equal(edit.status, 409);
    const del = await app.post(`/invoices/${id}/delete`);
    assert.equal(del.status, 409);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?').get(id).n, 1);
  }));

test('record payment and void', () =>
  withApp(async (app) => {
    await app.login();
    const { id } = await clientAndDraft(app);
    await app.post(`/invoices/${id}/lines`, { description: 'Work', quantity: '1', unit_price: '50', tax_rate: '0' });
    await app.post(`/invoices/${id}/send`);
    const badPay = await app.post(`/invoices/${id}/pay`, { paid_date: 'yesterday' });
    assert.equal(badPay.status, 400);
    assert.equal((await app.post(`/invoices/${id}/pay`, { paid_date: '2026-03-11', payment_method: 'bank' })).status, 303);
    assert.match((await app.get(`/invoices/${id}`)).text, /status-text">paid/);
    assert.match((await app.get(`/invoices/${id}/void`)).text, /Voiding is permanent/);
    await app.post(`/invoices/${id}/void`);
    const view = await app.get(`/invoices/${id}`);
    assert.match(view.text, /status-text">void/);
    assert.doesNotMatch(view.text, /Void…/);
  }));

test('the dashboard shows outstanding per currency, and overdue only as overdue', () =>
  withApp(async (app) => {
    await app.login();
    const usd = await clientAndDraft(app);
    await app.post(`/invoices/${usd.id}/lines`, { description: 'a', quantity: '1', unit_price: '100', tax_rate: '0' });
    await app.post(`/invoices/${usd.id}/send`);
    const late = await clientAndDraft(app);
    await app.post(`/invoices/${late.id}`, { client_id: String(late.clientId), currency: 'USD', due_date: '2026-03-12', notes: '' });
    await app.post(`/invoices/${late.id}/lines`, { description: 'b', quantity: '1', unit_price: '7', tax_rate: '0' });
    await app.post(`/invoices/${late.id}/send`);
    const eur = await clientAndDraft(app, { currency: 'EUR' });
    await app.post(`/invoices/${eur.id}/lines`, { description: 'c', quantity: '2', unit_price: '10', tax_rate: '0' });
    await app.post(`/invoices/${eur.id}/send`);

    app.clock.t = Date.parse('2026-03-13T10:00:00Z');
    await app.login(); // the 12-hour session ran out while the clock moved
    const dash = await app.get('/');
    const row = (cur) => new RegExp(`data-currency="${cur}">[\\s\\S]*?</tr>`).exec(dash.text)[0];
    assert.match(row('USD'), /outstanding">\$100\.00/);
    assert.match(row('USD'), /overdue">\$7\.00/);
    assert.match(row('EUR'), /outstanding">€20\.00/);
    assert.match(row('EUR'), /overdue">€0\.00/);
    assert.match(dash.text, /id="status-overdue"/);
  }));

test('user text is escaped everywhere it is shown', () =>
  withApp(async (app) => {
    await app.login();
    await app.post('/clients', { name: '<script>alert(1)</script>' });
    const clientId = app.db.prepare('SELECT id FROM clients').get().id;
    const res = await app.post('/invoices', { client_id: String(clientId), currency: 'USD' });
    const id = idFrom(res.location);
    await app.post(`/invoices/${id}/lines`, { description: '<img src=x onerror=alert(1)>', quantity: '1', unit_price: '1', tax_rate: '0' });
    for (const path of ['/clients', `/invoices/${id}`, `/invoices/${id}/print`, '/']) {
      const page = await app.get(path);
      assert.doesNotMatch(page.text, /<script>alert|<img src=x/, path);
    }
  }));

test('pages carry a strict CSP and no style attributes or inline scripts', () =>
  withApp(async (app) => {
    const login = await app.get('/login');
    assert.match(login.headers.get('content-security-policy'), /style-src 'self';/);
    assert.doesNotMatch(login.headers.get('content-security-policy'), /unsafe-inline/);
    await app.login();
    const { id } = await clientAndDraft(app);
    await app.post(`/invoices/${id}/lines`, { description: 'w', quantity: '1', unit_price: '1', tax_rate: '5' });
    const check = async (paths) => {
      for (const path of paths) {
        const page = await app.get(path);
        assert.equal(page.status, 200, path);
      assert.doesNotMatch(page.text, /style=/i, path);
      assert.doesNotMatch(page.text, /<style/i, path);
      assert.doesNotMatch(page.text, /<script(?![^>]*\bsrc=)/i, path);
      assert.doesNotMatch(page.text, /\son[a-z]+=/i, path);
      }
    };
    await check(['/', '/clients', '/settings', '/invoices/new', `/invoices/${id}`, `/invoices/${id}/send`, `/invoices/${id}/delete`, `/invoices/${id}/print`]);
    await app.post(`/invoices/${id}/send`);
    await check(['/', `/invoices/${id}`, `/invoices/${id}/pay`, `/invoices/${id}/void`, `/invoices/${id}/print`]);
  }));

test('settings validate and save', () =>
  withApp(async (app) => {
    await app.login();
    const bad = await app.post('/settings', { default_currency: 'usd', payment_terms_days: '-1', page_size: 'A3', timezone: 'Mars/Base' });
    assert.equal(bad.status, 400);
    assert.match(bad.text, /Choose A4 or Letter/);
    assert.match(bad.text, /IANA timezone/);
    assert.match(bad.text, /whole number of days/);
    const ok = await app.post('/settings', {
      business_name: 'Acme', default_currency: 'eur', payment_terms_days: '30', page_size: 'Letter', timezone: 'Europe/Berlin',
    });
    assert.equal(ok.status, 303);
    const s = app.db.prepare('SELECT * FROM settings').get();
    assert.equal(s.default_currency, 'EUR');
    assert.equal(s.page_size, 'Letter');
    assert.equal(s.payment_terms_days, 30);
  }));
