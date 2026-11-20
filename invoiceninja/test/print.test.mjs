import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startApp, idFrom } from './helpers.mjs';

async function seeded(app, { pageSize = 'A4' } = {}) {
  await app.login();
  await app.post('/settings', {
    business_name: 'Acme Studio', business_email: 'billing@acme.test', business_address: '1 Main St\nSpringfield',
    business_tax_id: 'AC-123', payment_details: 'IBAN XX00 1234', default_currency: 'USD',
    payment_terms_days: '14', page_size: pageSize, timezone: 'UTC',
  });
  await app.post('/clients', { name: 'Globex', address: '9 Old Rd', tax_id: 'GX-9' });
  const clientId = app.db.prepare('SELECT id FROM clients').get().id;
  const res = await app.post('/invoices', { client_id: String(clientId), currency: 'USD', notes: 'Thanks!' });
  const id = idFrom(res.location);
  await app.post(`/invoices/${id}/lines`, { description: 'Design', quantity: '3', unit_price: '33.33', tax_rate: '10' });
  await app.post(`/invoices/${id}/lines`, { description: 'Hosting', quantity: '1', unit_price: '20', tax_rate: '0' });
  return { id, clientId };
}

test('the print view of a sent invoice has number, both snapshots, lines, tax rows and total', async () => {
  const app = await startApp();
  try {
    const { id, clientId } = await seeded(app);
    await app.post(`/invoices/${id}/send`);
    // Later edits to the client and the business must not reach the printed invoice.
    await app.post(`/clients/${clientId}`, { name: 'Globex Renamed', address: 'Elsewhere' });
    await app.post('/settings', { business_name: 'New Name', default_currency: 'USD', payment_terms_days: '14', page_size: 'A4', timezone: 'UTC' });

    const page = await app.get(`/invoices/${id}/print`);
    assert.equal(page.status, 200);
    assert.match(page.text, /INV-2026-0001/);
    assert.match(page.text, /Acme Studio/);
    assert.match(page.text, /1 Main St<br>Springfield/);
    assert.match(page.text, /Globex/);
    assert.match(page.text, /9 Old Rd/);
    assert.doesNotMatch(page.text, /Globex Renamed|New Name/);
    assert.match(page.text, /Design/);
    assert.match(page.text, /Hosting/);
    assert.match(page.text, /Tax 10% <small>on \$99\.99<\/small>/);
    assert.match(page.text, /Total<\/th><td class="num">\$129\.99/);
    assert.match(page.text, /IBAN XX00 1234/);
    assert.match(page.text, /Headers and footers/);
    assert.match(page.text, /<thead>/);
    assert.match(page.text, /href="\/static\/page-a4\.css"/);
    assert.doesNotMatch(page.text, /DRAFT/);

    const css = await app.get('/static/page-a4.css');
    assert.match(css.text, /@page\s*\{\s*size:\s*A4/);
    const print = await app.get('/static/print.css');
    assert.match(print.text, /thead\s*\{\s*display:\s*table-header-group/);
    assert.match(print.text, /break-inside:\s*avoid/);
    assert.match(print.text, /\.print-bar\s*\{\s*display:\s*none/);
  } finally {
    await app.close();
  }
});

test('the Letter setting switches the @page rule', async () => {
  const app = await startApp();
  try {
    const { id } = await seeded(app, { pageSize: 'Letter' });
    const page = await app.get(`/invoices/${id}/print`);
    assert.match(page.text, /href="\/static\/page-letter\.css"/);
    const css = await app.get('/static/page-letter.css');
    assert.match(css.text, /@page\s*\{\s*size:\s*Letter/);
  } finally {
    await app.close();
  }
});

test('the print view of a draft shows a DRAFT marker and no number', async () => {
  const app = await startApp();
  try {
    const { id } = await seeded(app);
    const page = await app.get(`/invoices/${id}/print`);
    assert.match(page.text, /class="stamp stamp-draft">DRAFT</);
    assert.doesNotMatch(page.text, /INV-\d{4}/);
    assert.doesNotMatch(page.text, /invoice-number/);
  } finally {
    await app.close();
  }
});
