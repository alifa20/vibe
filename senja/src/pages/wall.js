import { config } from '../config.js';
import { avatarHtml, escapeHtml, layout, starsHtml } from '../ui.js';

const css = `
.hero { max-width: 660px; margin-bottom: 40px; }
.hero h1 {
  font-size: clamp(30px, 5.5vw, 46px); line-height: 1.08;
  letter-spacing: -.035em; margin: 0 0 12px; font-weight: 630;
}
.hero p { color: var(--ink-2); font-size: 17px; margin: 0 0 22px; max-width: 52ch; }
.hero-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.score { display: inline-flex; align-items: center; gap: 9px; font-size: 14px; color: var(--ink-2); }
.score b { color: var(--ink); font-weight: 600; }
.score .stars .star { font-size: 16px; }

.wall { columns: 1; column-gap: 20px; }
@media (min-width: 640px)  { .wall { columns: 2; } }
@media (min-width: 1000px) { .wall { columns: 3; } }
@media (min-width: 1340px) { .wall { columns: 4; } }

.card {
  break-inside: avoid; -webkit-column-break-inside: avoid; page-break-inside: avoid;
  margin: 0 0 20px; padding: 22px;
  background: var(--bg-elev); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow);
  display: flow-root;
  transition: border-color .18s ease, transform .18s ease;
}
@media (hover: hover) {
  .card:hover { border-color: var(--ink-3); transform: translateY(-2px); }
}
.card .stars { margin-bottom: 13px; }
.card blockquote {
  margin: 0 0 18px; font-size: 15.5px; line-height: 1.62;
  color: var(--ink); white-space: pre-line; overflow-wrap: break-word;
}
.card figcaption { display: flex; align-items: center; gap: 11px; }
.who { min-width: 0; }
.who .name { display: block; font-weight: 590; font-size: 14px; letter-spacing: -.005em; }
.who .role {
  display: block; font-size: 13px; color: var(--ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.empty {
  border: 1px dashed var(--line); border-radius: var(--radius);
  padding: 60px 24px; text-align: center; color: var(--ink-2);
}
.empty h2 { margin: 0 0 8px; font-size: 19px; color: var(--ink); letter-spacing: -.015em; }
.empty p { margin: 0 0 20px; }
`;

export function cardHtml(row) {
  return `
<figure class="card">
  ${starsHtml(row.rating)}
  <blockquote>${escapeHtml(row.text)}</blockquote>
  <figcaption>
    ${avatarHtml(row)}
    <div class="who">
      <span class="name">${escapeHtml(row.name)}</span>
      ${row.role ? `<span class="role">${escapeHtml(row.role)}</span>` : ''}
    </div>
  </figcaption>
</figure>`;
}

export function renderWall({ testimonials, stats }) {
  const average = stats.count ? (Math.round(stats.average * 10) / 10).toFixed(1) : null;

  const meta = stats.count
    ? `<div class="hero-meta">
         <span class="score">
           ${starsHtml(Math.round(stats.average))}
           <span><b>${average}</b> average from <b>${stats.count}</b> ${stats.count === 1 ? 'review' : 'reviews'}</span>
         </span>
       </div>`
    : '';

  const grid = testimonials.length
    ? `<div class="wall">${testimonials.map(cardHtml).join('')}</div>`
    : `<div class="empty">
         <h2>No testimonials yet</h2>
         <p>Approved testimonials will appear here.</p>
         <a class="btn btn--primary" href="/submit">Be the first to write one</a>
       </div>`;

  const body = `
<section class="hero">
  <h1>${escapeHtml(config.siteName)}</h1>
  <p>${escapeHtml(config.siteTagline)}</p>
  ${meta}
</section>
${grid}`;

  return layout({
    title: `Wall of love - ${config.siteName}`,
    description: config.siteTagline,
    head: css,
    body,
    wide: true,
    nav: '<a class="btn btn--sm btn--primary" href="/submit">Leave a testimonial</a>',
  });
}
