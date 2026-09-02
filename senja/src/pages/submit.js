import { config, limits } from '../config.js';
import { escapeHtml, layout } from '../ui.js';

const css = `
h1 { font-size: 30px; letter-spacing: -.028em; margin: 0 0 8px; line-height: 1.15; }
.lede { color: var(--ink-2); margin: 0 0 30px; font-size: 16px; }

.panel {
  background: var(--bg-elev); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow); padding: 24px;
}
@media (min-width: 560px) { .panel { padding: 28px; } }

.field { margin-bottom: 20px; }
.field:last-child { margin-bottom: 0; }
.field > label, .field-label {
  display: block; font-size: 13px; font-weight: 560; margin-bottom: 7px;
  letter-spacing: .005em;
}
.hint { color: var(--ink-3); font-weight: 400; }
.row { display: grid; gap: 20px; }
@media (min-width: 560px) { .row { grid-template-columns: 1fr 1fr; } }

input[type="text"], input[type="url"], textarea {
  width: 100%; padding: 10px 12px; font: inherit; font-size: 15px;
  color: var(--ink); background: var(--bg); border: 1px solid var(--line);
  border-radius: 10px; transition: border-color .15s ease, box-shadow .15s ease;
}
input:focus, textarea:focus {
  outline: none; border-color: var(--ink-3);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 8%, transparent);
}
textarea { min-height: 132px; resize: vertical; line-height: 1.6; }
::placeholder { color: var(--ink-3); }

.counter { display: block; text-align: right; font-size: 12px; color: var(--ink-3); margin-top: 6px; }
.counter.over { color: var(--danger); }

.rating { display: flex; flex-direction: row-reverse; justify-content: flex-end; gap: 3px; border: 0; padding: 0; margin: 0; }
.rating input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.rating label {
  font-size: 31px; line-height: 1; color: var(--line); cursor: pointer;
  padding: 0 1px; transition: color .12s ease, transform .12s ease;
}
.rating input:checked ~ label { color: var(--star); }
.rating:hover input:checked ~ label { color: var(--line); }
.rating label:hover, .rating label:hover ~ label { color: var(--star); }
.rating label:hover { transform: scale(1.08); }
.rating input:focus-visible + label { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 4px; }
.rating-line { display: flex; align-items: center; gap: 12px; }
.rating-line output { font-size: 13px; color: var(--ink-2); }

.avatar-picker { display: flex; align-items: center; gap: 16px; }
.avatar-preview {
  width: 62px; height: 62px; border-radius: 50%; flex: none; object-fit: cover;
  background: var(--bg-sunk); border: 1px dashed var(--line);
  display: grid; place-items: center; color: var(--ink-3); font-size: 11px; overflow: hidden;
}
.avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.avatar-inputs { flex: 1; min-width: 0; display: grid; gap: 9px; }
input[type="file"] { font: inherit; font-size: 13px; color: var(--ink-2); max-width: 100%; }
input[type="file"]::file-selector-button {
  font: inherit; font-size: 13px; margin-right: 10px; padding: 7px 12px; cursor: pointer;
  border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink);
}
.or { display: flex; align-items: center; gap: 10px; color: var(--ink-3); font-size: 12px; }
.or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }

.hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.actions { margin-top: 26px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

.done { text-align: center; padding: 46px 24px; }
.done .tick {
  width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 18px;
  display: grid; place-items: center; background: color-mix(in srgb, var(--ok) 15%, transparent);
  color: var(--ok);
}
.done h1 { font-size: 24px; }
`;

const script = `
(function () {
  var out = document.getElementById('rating-out');
  if (out) {
    document.querySelectorAll('.rating input').forEach(function (input) {
      input.addEventListener('change', function () {
        out.textContent = input.value + ' / 5';
      });
    });
  }

  var area = document.getElementById('text');
  var counter = document.getElementById('counter');
  if (area && counter) {
    var max = Number(area.getAttribute('maxlength')) || 0;
    var sync = function () {
      counter.textContent = area.value.length + ' / ' + max;
      counter.classList.toggle('over', area.value.length > max);
    };
    area.addEventListener('input', sync);
    sync();
  }

  var preview = document.getElementById('avatar-preview');
  var file = document.getElementById('avatar');
  var url = document.getElementById('avatar_url');
  var show = function (src) {
    preview.innerHTML = '';
    var img = new Image();
    img.alt = '';
    img.onerror = function () { preview.textContent = 'Preview'; };
    img.src = src;
    preview.appendChild(img);
  };
  if (preview && file) {
    file.addEventListener('change', function () {
      var chosen = file.files && file.files[0];
      if (!chosen) return;
      if (url) url.value = '';
      show(URL.createObjectURL(chosen));
    });
  }
  if (preview && url) {
    url.addEventListener('change', function () {
      if (!url.value.trim()) return;
      if (file) file.value = '';
      show(url.value.trim());
    });
  }
})();`;

const nav = '<a class="btn btn--sm btn--ghost" href="/wall">See the wall</a>';

export function renderSubmit({ values = {}, error = '' } = {}) {
  const value = (key) => escapeHtml(values[key] ?? '');
  const rating = Number(values.rating) || 0;

  const starInputs = [5, 4, 3, 2, 1]
    .map(
      (n) => `
        <input type="radio" id="rating-${n}" name="rating" value="${n}" required${n === rating ? ' checked' : ''}>
        <label for="rating-${n}" title="${n} star${n === 1 ? '' : 's'}">&#9733;<span class="hp">${n} stars</span></label>`,
    )
    .join('');

  const body = `
<h1>Share your experience</h1>
<p class="lede">${escapeHtml(config.siteTagline)} It takes about a minute, and nothing appears publicly until we review it.</p>

${error ? `<div class="flash flash--error" role="alert">${escapeHtml(error)}</div>` : ''}

<form class="panel" method="post" action="/submit" enctype="multipart/form-data">
  <div class="row">
    <div class="field">
      <label for="name">Your name</label>
      <input type="text" id="name" name="name" maxlength="${limits.name}" required
             autocomplete="name" placeholder="Ada Lovelace" value="${value('name')}">
    </div>
    <div class="field">
      <label for="role">Role &amp; company <span class="hint">(optional)</span></label>
      <input type="text" id="role" name="role" maxlength="${limits.role}"
             autocomplete="organization-title" placeholder="Head of Design, Acme" value="${value('role')}">
    </div>
  </div>

  <div class="field">
    <span class="field-label" id="rating-label">How would you rate us?</span>
    <div class="rating-line">
      <fieldset class="rating" aria-labelledby="rating-label">${starInputs}</fieldset>
      <output id="rating-out">${rating ? `${rating} / 5` : ''}</output>
    </div>
  </div>

  <div class="field">
    <label for="text">Your testimonial</label>
    <textarea id="text" name="text" required minlength="${limits.textMin}" maxlength="${limits.text}"
              placeholder="What did we help you do, and what difference did it make?">${value('text')}</textarea>
    <span class="counter" id="counter"></span>
  </div>

  <div class="field">
    <span class="field-label">Photo <span class="hint">(optional &mdash; cropped to ${config.avatarSize}px)</span></span>
    <div class="avatar-picker">
      <div class="avatar-preview" id="avatar-preview">Preview</div>
      <div class="avatar-inputs">
        <input type="file" id="avatar" name="avatar" accept="image/*">
        <span class="or">or</span>
        <input type="url" id="avatar_url" name="avatar_url" placeholder="https://example.com/photo.jpg"
               value="${value('avatar_url')}">
      </div>
    </div>
  </div>

  <div class="hp" aria-hidden="true">
    <label for="website">Leave this field empty</label>
    <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
  </div>

  <div class="actions">
    <button class="btn btn--primary" type="submit">Send testimonial</button>
    <span class="tiny muted">Reviewed before it goes live.</span>
  </div>
</form>`;

  return layout({
    title: `Share your experience - ${config.siteName}`,
    description: `Leave a testimonial for ${config.siteName}.`,
    head: css,
    body,
    script,
    nav,
  });
}

export function renderThanks() {
  const body = `
<div class="panel done">
  <div class="tick">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>
  </div>
  <h1>Thank you</h1>
  <p class="lede">Your testimonial is in the queue. We&rsquo;ll review it shortly &mdash; once approved it appears on the wall.</p>
  <div class="actions" style="justify-content:center">
    <a class="btn btn--primary" href="/wall">See the wall</a>
    <a class="btn" href="/submit">Submit another</a>
  </div>
</div>`;

  return layout({
    title: `Thank you - ${config.siteName}`,
    head: css,
    body,
    nav,
  });
}
