/* QRForge generator — everything runs in the browser, nothing is uploaded. */
(function () {
  'use strict';

  var PREVIEW = 320;
  var STORAGE_KEY = 'qrforge.style.v1';
  var MAX_LOGO_BYTES = 2 * 1024 * 1024;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    stage: $('stage'), qr: $('qr'), warn: $('warn'),
    data: $('data'), len: $('len'),
    fg: $('fg'), fgHex: $('fg-hex'), bg: $('bg'), bgHex: $('bg-hex'), transparent: $('transparent'),
    dots: $('dots'), cornerSquare: $('corner-square'), cornerDot: $('corner-dot'),
    ecc: $('ecc'), margin: $('margin'), marginOut: $('margin-out'),
    logo: $('logo'), logoClear: $('logo-clear'), logoHint: $('logo-hint'),
    logoSize: $('logo-size'), logoSizeOut: $('logo-size-out'), logoSizeField: $('logo-size-field'),
    logoHide: $('logo-hide'), logoHideField: $('logo-hide-field'),
    exportSize: $('export-size'), dlPng: $('dl-png'), dlSvg: $('dl-svg'), reset: $('reset')
  };

  var DEFAULTS = {
    fg: '#101828', bg: '#ffffff', transparent: false,
    dots: 'rounded', cornerSquare: 'extra-rounded', cornerDot: 'dot',
    ecc: 'Q', margin: 8, logoSize: 30, logoHide: true
  };

  var logoDataUrl = null;
  var qr = null;
  var renderTimer = null;

  /* ---------- style state ---------- */

  function currentStyle() {
    return {
      fg: el.fg.value,
      bg: el.bg.value,
      transparent: el.transparent.checked,
      dots: el.dots.value,
      cornerSquare: el.cornerSquare.value,
      cornerDot: el.cornerDot.value,
      ecc: el.ecc.value,
      margin: Number(el.margin.value),
      logoSize: Number(el.logoSize.value),
      logoHide: el.logoHide.checked
    };
  }

  function applyStyle(style) {
    setColor(el.fg, el.fgHex, style.fg);
    setColor(el.bg, el.bgHex, style.bg);
    el.transparent.checked = !!style.transparent;
    el.dots.value = style.dots;
    el.cornerSquare.value = style.cornerSquare;
    el.cornerDot.value = style.cornerDot;
    el.ecc.value = style.ecc;
    el.margin.value = style.margin;
    el.logoSize.value = style.logoSize;
    el.logoHide.checked = !!style.logoHide;
    syncOutputs();
  }

  function saveStyle() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentStyle()));
    } catch (e) { /* private mode — styling just won't persist */ }
  }

  function loadStyle() {
    try {
      var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored) return;
      var merged = Object.assign({}, DEFAULTS, stored);
      // Guard against values from an older build that no longer exist as options.
      if (!optionExists(el.dots, merged.dots)) merged.dots = DEFAULTS.dots;
      if (!optionExists(el.cornerSquare, merged.cornerSquare)) merged.cornerSquare = DEFAULTS.cornerSquare;
      if (!optionExists(el.cornerDot, merged.cornerDot)) merged.cornerDot = DEFAULTS.cornerDot;
      applyStyle(merged);
    } catch (e) { /* ignore corrupt state */ }
  }

  function optionExists(select, value) {
    return Array.prototype.some.call(select.options, function (o) { return o.value === value; });
  }

  /* ---------- colour inputs ---------- */

  function normaliseHex(value) {
    var hex = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : null;
  }

  function setColor(picker, text, value) {
    var hex = normaliseHex(value) || DEFAULTS[picker.id] || '#000000';
    picker.value = hex;
    text.value = hex;
  }

  function bindColor(picker, text) {
    picker.addEventListener('input', function () {
      text.value = picker.value;
      onChange();
    });
    text.addEventListener('input', function () {
      var hex = normaliseHex(text.value);
      if (hex) { picker.value = hex; onChange(); }
    });
    text.addEventListener('blur', function () {
      setColor(picker, text, text.value);
      onChange();
    });
  }

  /* ---------- qr options ---------- */

  function buildOptions(size, type) {
    var style = currentStyle();
    var scale = size / PREVIEW;
    var opts = {
      type: type,
      width: size,
      height: size,
      margin: Math.round(style.margin * scale),
      data: el.data.value.trim(),
      qrOptions: { errorCorrectionLevel: style.ecc },
      dotsOptions: { type: style.dots, color: style.fg },
      backgroundOptions: { color: style.transparent ? 'transparent' : style.bg },
      cornersSquareOptions: { type: style.cornerSquare || undefined, color: style.fg },
      cornersDotOptions: { type: style.cornerDot || undefined, color: style.fg },
      imageOptions: {
        // Embed the logo as a data URI so a downloaded SVG stands on its own.
        saveAsBlob: false,
        hideBackgroundDots: style.logoHide,
        imageSize: style.logoSize / 100,
        margin: Math.round(2 * scale)
      }
    };
    if (logoDataUrl) opts.image = logoDataUrl;
    return opts;
  }

  /* ---------- rendering ---------- */

  function setWarning(message) {
    el.warn.textContent = message || '';
    el.warn.hidden = !message;
  }

  function setDownloadsEnabled(enabled) {
    el.dlPng.disabled = !enabled;
    el.dlSvg.disabled = !enabled;
  }

  function render() {
    var data = el.data.value.trim();
    el.len.textContent = String(el.data.value.length);
    el.stage.classList.toggle('is-checkered', el.transparent.checked);

    if (!data) {
      if (qr) { qr.update({ data: '' }); }
      el.qr.replaceChildren();
      setWarning('');
      setDownloadsEnabled(false);
      return;
    }

    try {
      var opts = buildOptions(PREVIEW, 'svg');
      if (!qr) {
        qr = new QRCodeStyling(opts);
        qr.append(el.qr);
      } else {
        qr.update(opts);
      }
      setWarning('');
      setDownloadsEnabled(true);
    } catch (err) {
      setWarning(String(err && err.message ? err.message : err) +
        ' — try shortening the text or lowering the error correction level.');
      setDownloadsEnabled(false);
    }
  }

  function onChange() {
    render();
    saveStyle();
  }

  function onInput() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(onChange, 120);
  }

  function syncOutputs() {
    el.marginOut.value = el.margin.value;
    el.logoSizeOut.value = el.logoSize.value + '%';
    el.bg.disabled = el.transparent.checked;
    el.bgHex.disabled = el.transparent.checked;
    var hasLogo = !!logoDataUrl;
    el.logoClear.hidden = !hasLogo;
    el.logoSizeField.hidden = !hasLogo;
    el.logoHideField.hidden = !hasLogo;
  }

  /* ---------- logo ---------- */

  el.logo.addEventListener('change', function () {
    var file = el.logo.files && el.logo.files[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      el.logoHint.textContent = 'That file is larger than 2 MB. Pick a smaller image.';
      el.logo.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      logoDataUrl = String(reader.result);
      el.logoHint.textContent = file.name + ' — stays in your browser, nothing is uploaded.';
      // A logo punches a hole in the code, so lift error correction to survive it.
      if (el.ecc.value !== 'H') el.ecc.value = 'H';
      syncOutputs();
      onChange();
    };
    reader.onerror = function () {
      el.logoHint.textContent = 'Could not read that file.';
    };
    reader.readAsDataURL(file);
  });

  el.logoClear.addEventListener('click', function () {
    logoDataUrl = null;
    el.logo.value = '';
    el.logoHint.textContent = 'PNG, JPEG, WebP or SVG, up to 2 MB. Stays in your browser — nothing is uploaded.';
    syncOutputs();
    onChange();
  });

  /* ---------- export ---------- */

  function filenameFor(extension) {
    var data = el.data.value.trim();
    var base = 'qr-code';
    try {
      var url = new URL(data);
      base = (url.host + url.pathname).replace(/^www\./, '');
    } catch (e) {
      base = data.slice(0, 32);
    }
    base = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (base || 'qr-code') + '.' + extension;
  }

  function download(extension) {
    var button = extension === 'png' ? el.dlPng : el.dlSvg;
    var label = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing…';

    var size = extension === 'png' ? Number(el.exportSize.value) : 1024;
    var instance = new QRCodeStyling(buildOptions(size, extension === 'svg' ? 'svg' : 'canvas'));

    instance.getRawData(extension).then(function (blob) {
      if (!blob) throw new Error('Export failed');
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filenameFor(extension);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }).catch(function (err) {
      setWarning('Export failed: ' + (err && err.message ? err.message : err));
    }).finally(function () {
      button.disabled = false;
      button.textContent = label;
    });
  }

  el.dlPng.addEventListener('click', function () { download('png'); });
  el.dlSvg.addEventListener('click', function () { download('svg'); });

  el.reset.addEventListener('click', function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    applyStyle(DEFAULTS);
    onChange();
  });

  /* ---------- wiring ---------- */

  bindColor(el.fg, el.fgHex);
  bindColor(el.bg, el.bgHex);

  el.data.addEventListener('input', onInput);
  [el.dots, el.cornerSquare, el.cornerDot, el.ecc].forEach(function (control) {
    control.addEventListener('change', onChange);
  });
  [el.margin, el.logoSize].forEach(function (control) {
    control.addEventListener('input', function () { syncOutputs(); onInput(); });
  });
  [el.transparent, el.logoHide].forEach(function (control) {
    control.addEventListener('change', function () { syncOutputs(); onChange(); });
  });

  loadStyle();

  var prefill = new URLSearchParams(location.search).get('data');
  if (prefill) {
    el.data.value = prefill;
  } else {
    el.data.value = 'https://example.com';
  }

  syncOutputs();
  render();
})();
