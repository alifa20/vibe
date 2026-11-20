import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUA, isBotUA } from '../src/ua.mjs';

const cases = [
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    { browser: 'Chrome', os: 'macOS', device: 'desktop' }],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    { browser: 'Edge', os: 'Windows', device: 'desktop' }],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    { browser: 'Firefox', os: 'Linux', device: 'desktop' }],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    { browser: 'Safari', os: 'iOS', device: 'mobile' }],
  ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1',
    { browser: 'Chrome', os: 'iOS', device: 'tablet' }],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    { browser: 'Chrome', os: 'Android', device: 'mobile' }],
  ['Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36',
    { browser: 'Samsung Internet', os: 'Android', device: 'tablet' }],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0',
    { browser: 'Opera', os: 'Windows', device: 'desktop' }],
  ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    { browser: 'Chrome', os: 'ChromeOS', device: 'desktop' }],
  ['SomethingUnusual/1.0', { browser: 'Other', os: 'Other', device: 'desktop' }]
];

for (const [ua, expected] of cases) {
  test(`parseUA: ${expected.browser} on ${expected.os} (${expected.device})`, () => {
    assert.deepEqual(parseUA(ua), expected);
  });
}

test('bots and empty user agents are flagged', () => {
  assert.equal(isBotUA('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBotUA('curl/8.7.1'), true);
  assert.equal(isBotUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36'), true);
  assert.equal(isBotUA(''), true);
  assert.equal(isBotUA(undefined), true);
  assert.equal(isBotUA(cases[0][0]), false);
});
