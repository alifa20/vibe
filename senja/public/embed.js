/*!
 * Testimonial wall embed.
 *
 *   <div id="senja-wall"></div>
 *   <script src="https://your-host/embed.js" async></script>
 *
 * No iframe: the wall is rendered as real DOM in the host page and inherits the
 * host font. Options go on the div as data attributes (or on the script tag as
 * defaults for every wall on the page):
 *
 *   data-limit="12"          how many testimonials to show
 *   data-columns="3"         maximum columns (it still reflows to fit)
 *   data-theme="auto"        auto | light | dark
 *   data-min-rating="4"      hide anything below this rating
 *   data-summary="true"      show the "4.9 average from 32 reviews" line
 */
(function () {
  'use strict';

  var STYLE_ID = 'senja-embed-styles';
  var PREFIX = 'snj';

  var current =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (/embed\.js(\?|#|$)/.test(scripts[i].src || '')) return scripts[i];
      }
      return null;
    })();

  if (!current) return;

  var base = new URL(current.src, document.baseURI);
  var apiRoot = base.origin + base.pathname.replace(/\/embed\.js.*$/, '');
  var scriptOptions = current.dataset || {};

  var CSS = [
    '.' + PREFIX + '{font-family:inherit;font-size:inherit;line-height:1.55;color:var(--snj-ink);',
    '--snj-bg:transparent;--snj-card:#ffffff;--snj-line:#e6e2da;--snj-ink:#191817;',
    '--snj-ink-2:#6e6a63;--snj-star:#d99b1f;--snj-shadow:0 1px 2px rgba(24,23,22,.05),0 10px 28px -16px rgba(24,23,22,.22)}',

    '.' + PREFIX + '[data-theme="dark"]{--snj-card:#16161a;--snj-line:#27272c;--snj-ink:#f0efec;',
    '--snj-ink-2:#a49f98;--snj-star:#f0b537;--snj-shadow:0 1px 2px rgba(0,0,0,.5),0 12px 32px -18px rgba(0,0,0,.9)}',

    '@media (prefers-color-scheme:dark){.' + PREFIX + '[data-theme="auto"]{--snj-card:#16161a;',
    '--snj-line:#27272c;--snj-ink:#f0efec;--snj-ink-2:#a49f98;--snj-star:#f0b537;',
    '--snj-shadow:0 1px 2px rgba(0,0,0,.5),0 12px 32px -18px rgba(0,0,0,.9)}}',

    '.' + PREFIX + ' *{box-sizing:border-box}',
    '.' + PREFIX + '-summary{display:flex;align-items:center;gap:.55em;margin:0 0 1.25em;',
    'font-size:.9em;color:var(--snj-ink-2)}',
    '.' + PREFIX + '-summary b{color:var(--snj-ink);font-weight:600}',

    '.' + PREFIX + '-grid{columns:19em var(--snj-cols,3);column-gap:1.25em}',

    '.' + PREFIX + '-card{break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;',
    'display:flow-root;margin:0 0 1.25em;padding:1.35em;background:var(--snj-card);',
    'border:1px solid var(--snj-line);border-radius:14px;box-shadow:var(--snj-shadow)}',

    '.' + PREFIX + '-stars{display:inline-flex;gap:.1em;line-height:1;margin-bottom:.8em}',
    '.' + PREFIX + '-star{color:var(--snj-line);font-size:.95em}',
    '.' + PREFIX + '-star-on{color:var(--snj-star)}',

    '.' + PREFIX + '-quote{margin:0 0 1.1em;font-size:.97em;line-height:1.62;color:var(--snj-ink);',
    'white-space:pre-line;overflow-wrap:break-word}',

    '.' + PREFIX + '-by{display:flex;align-items:center;gap:.7em}',
    '.' + PREFIX + '-avatar{width:2.5em;height:2.5em;border-radius:50%;flex:none;object-fit:cover;',
    'display:grid;place-items:center;font-size:.82em;font-weight:600;letter-spacing:.02em;',
    'background:hsl(var(--snj-hue,210) 42% 88%);color:hsl(var(--snj-hue,210) 45% 26%);',
    'border:1px solid rgba(0,0,0,.06)}',
    '.' + PREFIX + '[data-theme="dark"] .' + PREFIX + '-avatar{background:hsl(var(--snj-hue,210) 28% 24%);',
    'color:hsl(var(--snj-hue,210) 55% 82%);border-color:rgba(255,255,255,.08)}',
    '@media (prefers-color-scheme:dark){.' + PREFIX + '[data-theme="auto"] .' + PREFIX + '-avatar{',
    'background:hsl(var(--snj-hue,210) 28% 24%);color:hsl(var(--snj-hue,210) 55% 82%);',
    'border-color:rgba(255,255,255,.08)}}',

    '.' + PREFIX + '-who{min-width:0}',
    '.' + PREFIX + '-name{display:block;font-weight:600;font-size:.9em}',
    '.' + PREFIX + '-role{display:block;font-size:.84em;color:var(--snj-ink-2);',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.' + PREFIX + '-in{opacity:0;animation:snj-in .45s ease forwards}',
    '@keyframes snj-in{to{opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.' + PREFIX + '-in{animation:none;opacity:1}}',
  ].join('');

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function option(target, key, fallback) {
    var value = target.dataset[key];
    if (value === undefined || value === '') value = scriptOptions[key];
    if (value === undefined || value === '') return fallback;
    return value;
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function hueFor(name) {
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
    return hash;
  }

  function initialsFor(name) {
    var words = String(name).trim().split(/\s+/).slice(0, 2);
    var out = '';
    for (var i = 0; i < words.length; i++) out += words[i].charAt(0);
    return out.toUpperCase() || '?';
  }

  function starsNode(rating) {
    var wrap = element('span', PREFIX + '-stars');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', rating + ' out of 5 stars');
    for (var i = 1; i <= 5; i++) {
      wrap.appendChild(
        element('span', PREFIX + '-star' + (i <= rating ? ' ' + PREFIX + '-star-on' : ''), '★'),
      );
    }
    return wrap;
  }

  function cardNode(item) {
    var card = element('figure', PREFIX + '-card ' + PREFIX + '-in');
    card.appendChild(starsNode(item.rating));
    card.appendChild(element('blockquote', PREFIX + '-quote', item.text));

    var by = element('figcaption', PREFIX + '-by');
    if (item.avatar) {
      var img = element('img', PREFIX + '-avatar');
      img.src = item.avatar;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      by.appendChild(img);
    } else {
      var fallback = element('span', PREFIX + '-avatar', initialsFor(item.name));
      fallback.style.setProperty('--snj-hue', hueFor(item.name));
      fallback.setAttribute('aria-hidden', 'true');
      by.appendChild(fallback);
    }

    var who = element('div', PREFIX + '-who');
    who.appendChild(element('span', PREFIX + '-name', item.name));
    if (item.role) who.appendChild(element('span', PREFIX + '-role', item.role));
    by.appendChild(who);

    card.appendChild(by);
    return card;
  }

  function summaryNode(data) {
    var wrap = element('div', PREFIX + '-summary');
    wrap.appendChild(starsNode(Math.round(data.average)));
    var text = element('span');
    text.appendChild(element('b', null, String(data.average)));
    text.appendChild(
      document.createTextNode(
        ' average from ' + data.count + ' ' + (data.count === 1 ? 'review' : 'reviews'),
      ),
    );
    wrap.appendChild(text);
    return wrap;
  }

  function render(target) {
    if (target.dataset.senjaReady === '1') return;
    target.dataset.senjaReady = '1';
    injectStyles();

    var limit = option(target, 'limit', '30');
    var minRating = option(target, 'minRating', '1');
    var theme = option(target, 'theme', 'auto');
    var columns = option(target, 'columns', '3');
    var showSummary = String(option(target, 'summary', 'false')) === 'true';

    target.classList.add(PREFIX);
    target.setAttribute('data-theme', theme === 'light' || theme === 'dark' ? theme : 'auto');
    target.setAttribute('aria-busy', 'true');

    var query = '?limit=' + encodeURIComponent(limit) + '&minRating=' + encodeURIComponent(minRating);

    fetch(apiRoot + '/api/testimonials' + query, { credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        target.removeAttribute('aria-busy');
        var items = data.testimonials || [];
        if (!items.length) return;

        var fragment = document.createDocumentFragment();
        if (showSummary && data.count) fragment.appendChild(summaryNode(data));

        var grid = element('div', PREFIX + '-grid');
        grid.style.setProperty('--snj-cols', String(parseInt(columns, 10) || 3));
        for (var i = 0; i < items.length; i++) grid.appendChild(cardNode(items[i]));

        fragment.appendChild(grid);
        target.appendChild(fragment);
      })
      .catch(function (error) {
        target.removeAttribute('aria-busy');
        target.dataset.senjaReady = '';
        if (window.console) console.warn('[testimonials] could not load the wall:', error);
      });
  }

  function mount() {
    var targets = document.querySelectorAll('[data-senja-wall], #senja-wall');
    for (var i = 0; i < targets.length; i++) render(targets[i]);
  }

  window.SenjaWall = { mount: mount, render: render, api: apiRoot };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
