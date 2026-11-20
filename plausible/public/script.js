/*
 * Pageview tracker. Add to a site with:
 *   <script defer data-domain="example.com" src="https://stats.example.com/script.js"></script>
 *
 * Optional attributes:
 *   data-respect-dnt   skip visitors whose browser sends Do Not Track
 *   data-api           send to another endpoint (default: /api/event next to this file)
 *
 * It writes nothing to the visitor's device and reads nothing back. Each view
 * is one small text/plain POST, which browsers send without a CORS preflight.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var domain = script.getAttribute('data-domain') || location.hostname;
  var endpoint = script.getAttribute('data-api') || new URL('/api/event', script.src).href;
  var respectDnt = script.hasAttribute('data-respect-dnt');

  function dntEnabled() {
    var value = navigator.doNotTrack || window.doNotTrack;
    return value === '1' || value === 'yes';
  }

  if (navigator.globalPrivacyControl) return;
  if (respectDnt && dntEnabled()) return;

  function post(body) {
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return;
    } catch (e) { /* fall through to fetch */ }
    if (window.fetch) {
      fetch(endpoint, {
        method: 'POST',
        body: body,
        keepalive: true,
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain' }
      }).catch(function () {});
    }
  }

  var lastPath = null;

  function pageview() {
    // Query-string changes on the same path are not a new view.
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    post(JSON.stringify({
      d: domain,
      u: location.href,
      r: document.referrer || null,
      h: respectDnt ? 1 : 0
    }));
  }

  // Single-page apps: count route changes made through the History API.
  var history = window.history;
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    history[name] = function () {
      var result = original.apply(this, arguments);
      pageview();
      return result;
    };
  });
  window.addEventListener('popstate', pageview);

  if (document.visibilityState === 'prerender') {
    document.addEventListener('visibilitychange', function onVisible() {
      if (document.visibilityState === 'prerender') return;
      document.removeEventListener('visibilitychange', onVisible);
      pageview();
    });
  } else {
    pageview();
  }
})();
