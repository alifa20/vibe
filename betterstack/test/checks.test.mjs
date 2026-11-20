import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpected, runHttpCheck, statusMatches, validateMonitor } from '../src/checks.mjs';
import { closedPort, targetServer } from './helpers.mjs';

const monitor = (url, extra = {}) => ({ url, timeout_s: 5, expected: '200-299', ...extra });

test('a 200 inside 200-299 is a success with a latency', async (t) => {
  const target = await targetServer(200);
  t.after(target.close);
  const r = await runHttpCheck(monitor(target.url));
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.error, null);
  assert.ok(r.latencyMs >= 0);
});

test('a 500 when 200-299 is expected is a failure', async (t) => {
  const target = await targetServer(500);
  t.after(target.close);
  const r = await runHttpCheck(monitor(target.url));
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  assert.equal(r.error, 'HTTP 500, expected 200-299');
});

test('a timeout produces a failure whose error says timeout', async (t) => {
  const target = await targetServer(200);
  t.after(target.close);
  const controller = new AbortController();
  // The server never answers; the "timer" fires as soon as the request lands.
  target.state.onRequest = () => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  const r = await runHttpCheck(monitor(target.url), { signalFor: () => controller.signal });
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout/);
  assert.equal(r.error, 'timeout after 5s');
});

test('a refused connection is a failure naming the cause', async () => {
  const port = await closedPort();
  const r = await runHttpCheck(monitor(`http://127.0.0.1:${port}/`));
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
});

test('expected status lists and ranges', () => {
  assert.deepEqual(parseExpected('200-299, 301'), [[200, 299], [301, 301]]);
  assert.equal(parseExpected('2xx'), null);
  assert.equal(parseExpected('299-200'), null);
  assert.equal(statusMatches(301, '200-299,301'), true);
  assert.equal(statusMatches(302, '200-299,301'), false);
});

const good = { name: 'site', url: 'https://example.com', interval_s: '60', timeout_s: '10', expected: '200-299', down_after: '2', up_after: '1' };

test('a valid monitor form has no errors', () => {
  const { values, errors } = validateMonitor(good);
  assert.deepEqual(errors, {});
  assert.equal(values.interval_s, 60);
  assert.equal(values.url, 'https://example.com/');
});

test('a timeout of at least the interval is rejected at create time', () => {
  assert.equal(validateMonitor({ ...good, timeout_s: '60', interval_s: '60' }).errors.timeout_s, 'Timeout must be shorter than the interval.');
  assert.equal(validateMonitor({ ...good, timeout_s: '30', interval_s: '30' }).errors.timeout_s, 'Timeout must be shorter than the interval.');
  assert.equal(validateMonitor({ ...good, timeout_s: '29', interval_s: '30' }).errors.timeout_s, undefined);
});

test('field errors for bad input', () => {
  const { errors } = validateMonitor({ name: '', url: 'ftp://x', interval_s: '5', timeout_s: 'abc', expected: 'ok', down_after: '0', up_after: '11' });
  assert.deepEqual(Object.keys(errors).sort(), ['down_after', 'expected', 'interval_s', 'name', 'timeout_s', 'up_after', 'url']);
});
