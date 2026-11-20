import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSite } from '../src/db.mjs';
import { normaliseDomain } from '../src/dashboard.mjs';
import { barChart } from '../src/charts.mjs';
import { boot, login, seedEvent, hit } from './helpers.mjs';

async function withDashboard(fn) {
  const ctx = await boot();
  const site = addSite(ctx.db, { domain: 'example.com', createdAt: ctx.clock.now() });
  const cookie = await login(ctx.base);
  const get = async (p) => {
    const res = await fetch(ctx.base + p, { headers: { cookie }, redirect: 'manual' });
    return { res, html: await res.text() };
  };
  const post = (p, fields) => fetch(ctx.base + p, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(fields)
  });
  try {
    await fn({ ...ctx, site, cookie, get, post });
  } finally {
    await ctx.close();
  }
}

const metric = (html, name) => html.match(new RegExp(`data-metric="${name}">([^<]*)<`))?.[1];
const bars = (html) => [...html.matchAll(/<rect class="bar pv[^"]*" data-day="([^"]+)" data-pageviews="(\d+)" data-visitors="(\d+)"/g)]
  .map(([, day, pv, v]) => ({ day, pageviews: Number(pv), visitors: Number(v) }));
const tableKeys = (html, name) => {
  const table = html.match(new RegExp(`<table data-breakdown="${name}">([\\s\\S]*?)</table>`))?.[1] ?? '';
  return [...table.matchAll(/<td class="key">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
};

// ------------------------------------------------------------ domain input

test('normaliseDomain strips scheme, www., path and port, and lowercases', () => {
  assert.deepEqual(normaliseDomain('https://www.Example.com/'), { domain: 'example.com' });
  assert.deepEqual(normaliseDomain('  Blog.Example.co.uk:8080/path?q=1 '), { domain: 'blog.example.co.uk' });
  assert.deepEqual(normaliseDomain('http://user:pw@shop.example.com#x'), { domain: 'shop.example.com' });
  assert.deepEqual(normaliseDomain('localhost:3000'), { domain: 'localhost' });
  for (const bad of ['', 'not a domain', 'https://', 'example', '-bad-.com', 'exa_mple.com', '192.168.1.1', 'a..b.com']) {
    assert.ok(normaliseDomain(bad).error, `"${bad}" should be rejected`);
  }
});

test('adding https://www.Example.com/ registers example.com', async () => {
  await withDashboard(async ({ db, post, get }) => {
    db.prepare('DELETE FROM sites').run();
    const res = await post('/sites', { domain: 'https://www.Example.com/' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/sites/example.com');
    assert.deepEqual(db.prepare('SELECT domain FROM sites').all(), [{ domain: 'example.com' }]);
    const { html } = await get('/');
    assert.match(html, /href="\/sites\/example\.com"/);
  });
});

test('adding "not a domain" shows a field error and registers nothing', async () => {
  await withDashboard(async ({ db, post }) => {
    const res = await post('/sites', { domain: 'not a <b>domain</b>' });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /class="field-error"/);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /value="not a &lt;b&gt;domain&lt;\/b&gt;"/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sites').get().n, 1);
  });
});

test('adding an existing domain just goes to it', async () => {
  await withDashboard(async ({ db, post }) => {
    const res = await post('/sites', { domain: 'example.com' });
    assert.equal(res.status, 303);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sites').get().n, 1);
  });
});

// ------------------------------------------------------------- site view

test('a site with no events shows the waiting state and the snippet', async () => {
  await withDashboard(async ({ get, base }) => {
    const { res, html } = await get('/sites/example.com');
    assert.equal(res.status, 200);
    assert.match(html, /Waiting for the first pageview/);
    assert.ok(html.includes(`&lt;script defer data-domain=&quot;example.com&quot; src=&quot;${base}/script.js&quot;&gt;&lt;/script&gt;`));
  });
});

test('the snippet stays reachable once data arrives', async () => {
  await withDashboard(async ({ get, base, flush }) => {
    await hit(base, { d: 'example.com', u: 'https://example.com/' });
    flush();
    const { html } = await get('/sites/example.com');
    assert.ok(!html.includes('Waiting for the first pageview'));
    assert.match(html, /data-domain=&quot;example.com&quot;/);
  });
});

test('AE1: a 2-day range shows 1 visitor per day and a total of 2, labelled as a sum of daily uniques', async () => {
  await withDashboard(async ({ db, site, get }) => {
    seedEvent(db, site.id, { day: '2026-11-19', visitor_hash: 'aaaa', path: '/' });
    seedEvent(db, site.id, { day: '2026-11-19', visitor_hash: 'aaaa', path: '/about' });
    seedEvent(db, site.id, { day: '2026-11-20', visitor_hash: 'bbbb', path: '/' });
    const { html } = await get('/sites/example.com?range=custom&from=2026-11-19&to=2026-11-20');
    assert.equal(metric(html, 'pageviews'), '3');
    assert.equal(metric(html, 'visitors'), '2');
    assert.match(html, /sum of daily uniques/i);
    assert.deepEqual(bars(html), [
      { day: '2026-11-19', pageviews: 2, visitors: 1 },
      { day: '2026-11-20', pageviews: 1, visitors: 1 }
    ]);
  });
});

test('days with no events render as zero bars, not gaps', async () => {
  await withDashboard(async ({ db, site, get }) => {
    seedEvent(db, site.id, { day: '2026-11-17' });
    const { html } = await get('/sites/example.com?range=7d');
    const series = bars(html);
    assert.equal(series.length, 7);
    assert.equal(series[0].day, '2026-11-14');
    assert.equal(series[6].day, '2026-11-20');
    assert.deepEqual(series.map((b) => b.pageviews), [0, 0, 0, 1, 0, 0, 0]);
    assert.equal((html.match(/class="bar pv zero"/g) || []).length, 6);
  });
});

test('range presets: today, 30d by default, and custom', async () => {
  await withDashboard(async ({ db, site, get }) => {
    seedEvent(db, site.id, { day: '2026-11-20' });
    assert.equal(bars((await get('/sites/example.com?range=today')).html).length, 1);
    assert.equal(bars((await get('/sites/example.com')).html).length, 30);
    // A reversed custom range is read the right way round.
    const swapped = bars((await get('/sites/example.com?range=custom&from=2026-11-10&to=2026-11-01')).html);
    assert.equal(swapped.length, 10);
    assert.equal(swapped[0].day, '2026-11-01');
    // An unreadable custom range falls back to 30 days with a note.
    const bad = await get('/sites/example.com?range=custom&from=yesterday&to=2026-11-01');
    assert.equal(bars(bad.html).length, 30);
    assert.match(bad.html, /class="flash/);
  });
});

test('top pages are ordered by pageviews, ties broken by path', async () => {
  await withDashboard(async ({ db, site, get }) => {
    for (const p of ['/b', '/a', '/c', '/c', '/c', '/d', '/d']) seedEvent(db, site.id, { day: '2026-11-20', path: p });
    const { html } = await get('/sites/example.com?range=today');
    assert.deepEqual(tableKeys(html, 'pages'), ['/c', '/d', '/a', '/b']);
  });
});

test('every breakdown is shown', async () => {
  await withDashboard(async ({ db, site, get }) => {
    seedEvent(db, site.id, {
      day: '2026-11-20', referrer_host: 'news.ycombinator.com', utm_source: 'newsletter',
      utm_campaign: 'launch', browser: 'Firefox', os: 'Linux', device: 'mobile'
    });
    const { html } = await get('/sites/example.com?range=today');
    assert.deepEqual(tableKeys(html, 'referrers'), ['news.ycombinator.com']);
    assert.deepEqual(tableKeys(html, 'sources'), ['newsletter']);
    assert.deepEqual(tableKeys(html, 'campaigns'), ['launch']);
    assert.deepEqual(tableKeys(html, 'browsers'), ['Firefox']);
    assert.deepEqual(tableKeys(html, 'os'), ['Linux']);
    assert.deepEqual(tableKeys(html, 'devices'), ['mobile']);
  });
});

test('collected values render as escaped text', async () => {
  await withDashboard(async ({ db, site, get }) => {
    seedEvent(db, site.id, { day: '2026-11-20', path: '/<script>alert(1)</script>', utm_source: '"><a href=x>' });
    const { html } = await get('/sites/example.com?range=today');
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('"><a href=x>'));
    assert.deepEqual(tableKeys(html, 'pages'), ['/&lt;script&gt;alert(1)&lt;/script&gt;']);
    assert.deepEqual(tableKeys(html, 'sources'), ['&quot;&gt;&lt;a href=x&gt;']);
  });
});

test('no rendered page carries a style= attribute', async () => {
  await withDashboard(async ({ db, site, get, post }) => {
    const pages = [(await get('/')).html, (await get('/sites/example.com')).html];
    seedEvent(db, site.id, { day: '2026-11-20', path: '/x', referrer_host: 'a.com', utm_source: 's' });
    pages.push((await get('/sites/example.com?range=7d')).html);
    pages.push(await (await post('/sites', { domain: 'nope nope' })).text());
    for (const html of pages) {
      assert.ok(!/\sstyle\s*=/i.test(html));
      assert.ok(!/<style/i.test(html));
      assert.ok(!/<script/i.test(html), 'the dashboard runs no scripts');
    }
  });
});

test('an unknown site is a 404', async () => {
  await withDashboard(async ({ get }) => {
    assert.equal((await get('/sites/nope.example')).res.status, 404);
  });
});

test('the site list shows each site with its pageviews today', async () => {
  await withDashboard(async ({ db, site, get }) => {
    seedEvent(db, site.id, { day: '2026-11-20' });
    seedEvent(db, site.id, { day: '2026-11-19' });
    const { html } = await get('/');
    assert.match(html, /example\.com/);
    assert.match(html, /name="domain"/);
    assert.match(html, /data-today="1"/);
  });
});

test('barChart draws bars with attributes only and scales to the peak', () => {
  const svg = barChart([
    { day: '2026-11-19', pageviews: 4, visitors: 2 },
    { day: '2026-11-20', pageviews: 0, visitors: 0 }
  ]);
  assert.match(svg, /^<svg[^>]*viewBox=/);
  assert.ok(!/style=/.test(svg));
  assert.match(svg, /<rect class="bar pv" data-day="2026-11-19" data-pageviews="4" data-visitors="2" x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+"/);
  assert.match(svg, /<rect class="bar pv zero" data-day="2026-11-20"/);
});
