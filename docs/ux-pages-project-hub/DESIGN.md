---
name: vibe
description: Sticker-sheet visual identity for the vibe GitHub Pages site. It covers the hub, the per-project pages and the nav strip injected into the live demos.
status: draft
created: 2026-11-20T01:13:13Z
updated: 2026-11-20T01:13:13Z
colors:
  # Page scheme, light
  bg: '#fff3d6'
  surface: '#ffffff'
  ink: '#121212'
  ink-2: '#4b4740'
  line: '#121212'
  shadow: '#121212'
  dots: '#f1dfb4'
  # Page scheme, dark
  bg-dark: '#17151d'
  surface-dark: '#24212c'
  ink-dark: '#f6f0e2'
  ink-2-dark: '#b9b2a3'
  line-dark: '#f6f0e2'
  shadow-dark: '#f6f0e2'
  dots-dark: '#23202a'
  # Project colours. Same in both schemes. Text on them is always {colors.ink}.
  project-teleprompter: '#ff5247'
  project-personal-site: '#ffd23f'
  project-golinks: '#4d86ff'
  project-linkinbio: '#ff8fcf'
  project-qrforge: '#a07bff'
  project-senja: '#c8f03c'
  project-forms: '#ff9f2e'
  project-zcal: '#5cd2ff'
  # Nav strip and vibe's own colour (wordmark, 404 sticker). Fixed across schemes.
  # [OPEN] Same hex as project-personal-site; see EXPERIENCE.md Open Questions.
  nav-bg: '#ffd23f'
  nav-ink: '#121212'
  nav-pill: '#ffffff'
  # Terminal block on project pages
  term-bg: '#121212'
  term-ink: '#f6f0e2'
  term-muted: '#8d877b'
  copy-bg: '#ffd23f'
typography:
  display-xl:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'
    fontSize: 168px
    fontWeight: '900'
    lineHeight: '0.8'
    letterSpacing: -0.07em
  display-lg:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'
    fontSize: 42px
    fontWeight: '900'
    lineHeight: '1'
    letterSpacing: -0.03em
  heading:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'
    fontSize: 26px
    fontWeight: '900'
    lineHeight: '1'
    letterSpacing: -0.02em
  card-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'
    fontSize: 32px
    fontWeight: '900'
    lineHeight: '1'
    letterSpacing: -0.03em
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'
    fontSize: 16px
    fontWeight: '500'
    lineHeight: '1.45'
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif'
    fontSize: 13px
    fontWeight: '800'
    lineHeight: '1'
  mono:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
  code:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.75'
rounded:
  none: 0px
  full: 9999px
  DEFAULT: 0px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 26px
  '7': 34px
  '8': 44px
  margin-mobile: 16px
  margin-desktop: 48px
  tap-min: 44px
  border: 3px
  border-thin: 2px
  shadow-rest: 6px
  shadow-lift: 9px
  shadow-press: 2px
components:
  project-card:
    background: '{colors.project-*}'
    foreground: '{colors.ink}'
    border: '{spacing.border} solid {colors.line}'
    shadow: '{spacing.shadow-rest} {spacing.shadow-rest} 0 {colors.shadow}'
    radius: '{rounded.none}'
  badge-live:
    background: '{colors.ink}'
    foreground: '{colors.project-*}'
    radius: '{rounded.full}'
  badge-server:
    background: '{colors.surface}'
    foreground: '{colors.ink}'
    border: '{spacing.border-thin} dashed {colors.ink}'
    radius: '{rounded.full}'
  inspired-sticker:
    background: '#ffffff'
    foreground: '{colors.ink}'
    border: '{spacing.border-thin} solid {colors.ink}'
    rotate: '-3deg to 4deg'
  stack-tag:
    background: '#ffffff'
    foreground: '{colors.ink}'
    typography: '{typography.mono}'
  nav-strip:
    background: '{colors.nav-bg}'
    foreground: '{colors.nav-ink}'
    height: 56px
    border-bottom: '{spacing.border} solid {colors.nav-ink}'
  nav-back-pill:
    background: '{colors.nav-ink}'
    foreground: '{colors.nav-bg}'
    radius: '{rounded.full}'
  nav-switcher:
    background: '{colors.nav-pill}'
    foreground: '{colors.nav-ink}'
    radius: '{rounded.full}'
  terminal-block:
    background: '{colors.term-bg}'
    foreground: '{colors.term-ink}'
    shadow: '8px 8px 0 {colors.project-*}'
  copy-button:
    background: '{colors.copy-bg}'
    foreground: '{colors.ink}'
---

## Brand & Style

vibe is a sheet of stickers: eight small apps Ali built with AI, each one a loud, flat, outlined block in its own colour. It looks hand-assembled. The site is mostly Ali's own index for jumping between experiments, so it can be loud and a bit silly. It should still be fast to scan and never get in the way of the app it wraps.

The register is neo-brutalist. That means flat colour, thick black outlines, hard offset shadows with no blur, heavy sans type and the odd tilted label. Nothing is glossy, blurred or gradient-filled. The only texture is the dotted page background.

Mockups: [direction pick](.working/direction-sticker-sheet.html) and the key screens under [mockups/](mockups/). This spine wins over any mockup when they conflict.

## Colors

- **Page scheme** (`bg`, `surface`, `ink`, `ink-2`, `line`, `shadow`, `dots`). The light scheme is warm cream paper with black ink. The dark scheme is a near-black violet with cream ink, and its outlines and shadows turn cream so the sticker edges stay visible. The scheme follows `prefers-color-scheme`.
- **Project colours** (`project-*`). Each project owns one colour, and that colour identifies it everywhere: the hub card, the band on its project page, the dot in the nav switcher, and the shadow on its terminal block. The colours are the same in both schemes, and the text on them is always `{colors.ink}`. Don't use a project colour for anything that isn't that project. [ASSUMPTION] golinks `#4d86ff` with `#121212` text comes to about 5.5:1. Check every pairing against WCAG AA in the build.
- **Nav strip** (`nav-*`). It is always yellow on black, whatever the host page or scheme. It belongs to vibe, not the demo, and it must look the same in both schemes.
- **Terminal** (`term-*`, `copy-bg`). The run-it-locally block is always dark, in both schemes.

## Typography

There is one sans stack (the system's Helvetica class) and one mono stack, and no web fonts. The display sizes are very heavy (900) and tightly tracked, used for the "vibe" wordmark and the project names. Body text is weight 500 at 16px. Mono is reserved for machine-ish things: stack tags, the URL crumb, terminal commands, group labels in the switcher.

Everything is lowercase except in code. The phone sizes are `display-xl` 104px, `card-title` 28px and `heading` 22px.

## Layout & Spacing

The hub is a centred column up to about 1100px wide, with `{spacing.margin-desktop}` side gutters on desktop and `{spacing.margin-mobile}` on phones. Card grids run 2 columns for live demos and 3 for the server apps (or 4 → 2 → 1 in the single-grid variant). Everything collapses to 1 column below 600px. Gaps are `{spacing.6}`, wide enough for the offset shadows to stay clear of the next card.

The project page has a coloured band (name, pitch, stickers), then a body of two columns: screenshots on the left, and "what it does" plus "run it locally" on the right. Below 600px the band and both columns stack.

## Elevation & Depth

Depth comes from hard offset shadows only (`x y 0 shadow`). There is no blur and no transparency.

| State | Card | Small control |
|---|---|---|
| rest | 6px offset | 3–4px offset |
| hover | moves -3,-3 and the shadow grows to 9px | moves -1,-1 with a 4px shadow |
| pressed | moves +4,+4 and the shadow shrinks to 2px | moves +3,+3 with no shadow |

Shadows are the same colour as `line`, so they turn cream in dark mode.

## Shapes

Blocks have square corners: cards, frames, buttons, the terminal and the band. Only these are round: pills (the back link, the switcher, badges) and circles (number badges, colour dots). Stickers ("inspired by", screenshot labels, the hero wordmark) tilt between -4° and +4°, and no more than one tilted element sits in any one card.

## Components

- **Project card.** The whole card is one link to `/vibe/<slug>/`, filled with the project's colour and a 3px outline. It holds, from top to bottom: a number badge (01–08), the name in `card-title`, a one-line description, and a footer with the stack tag and a status badge. The "inspired by X" sticker hangs off the top-right edge. A "→" in the bottom-right corner shows on desktop only.
- **Status badge.** "live demo" is a solid ink pill whose text is the project colour. "needs a server" is a white pill with a dashed outline.
- **Section heading.** A 26px heading, a count in a circle, and a muted one-line explainer that is hidden on phones.
- **Project band.** Full-width in the project colour with a 4px bottom rule. It holds the number, the name in `display-xl` (on phones: 104px for names up to 6 characters, 64px for longer ones such as linkinbio, qrforge and golinks), the pitch at 22px/700, and on the right the inspired-by sticker, the status badge and the stack tag.
- **Screenshot frame.** A surface box with an outline and an 8px shadow, and a tilted mono label ("screenshot: booking page"). Until real captures exist, a hatched placeholder fills it. On phones, all the frames stack in one column.
- **Feature tiles.** A 2-column list of outlined tiles, each numbered with a dot in the project colour.
- **Terminal block.** A dark box with a header row (the shell name on the left, a yellow "copy" button on the right) and the commands in `code`. Prompts use the project colour. Its shadow uses the project colour, not ink. After a copy, the button shows its pressed state and reads "copied ✓" for 2 seconds.
- **Source button.** A full-width bar in `surface` with an ink outline and a 6px shadow. It reads "source on github ↗". It is neutral on purpose: a project colour here would break the one-colour-per-project rule.
- **Nav strip.** It is 56px tall, in-flow and yellow, with a 3px bottom rule. From left to right it holds the black "← vibe" pill, a mono crumb showing the display name, not the folder slug ("/ golinks", not "/ bitly"), and pushed right: a "‹ prev" step, the switcher pill (colour dot, current name, ▾) and a "next ›" step. Below 600px the crumb and step labels hide, leaving `← vibe  ‹ [● zcal ▾] ›`, and a long current name in the switcher pill ends in an ellipsis rather than wrapping the strip. The switcher's menu is a white panel with an outline and a 6px shadow. It groups the projects under "live demos" and "run it yourself", and marks the current one with its colour fill and a "you're here" chip.
- **Hub chrome.** A top bar with "ali's vibe log" on the left and a "source on github ↗" button on the right, then the hero: a tilted "vibe" wordmark sticker in `nav-bg` yellow (vibe's own colour) and the line "— eight things I built with AI". The footer holds a one-line credit and the source link, underlined in ink.
- **404.** It uses the hub's chrome with one big tilted sticker reading "404 — nothing here", and a single "← back to vibe" button.

## Do's and Don'ts

- Do keep text on any project colour in `{colors.ink}`.
- Do keep the nav strip yellow everywhere, including on demos that have their own dark UI.
- Do use one tilt per card at most. Tilt is seasoning, not structure.
- Don't add blur, gradients, glows or rounded cards. A rounded card reads as the rejected draft.
- Don't use inline `style` attributes in the nav strip. Personal-site's CSP blocks them. Project colours come from classes (`.p-zcal`), not `style="--c:…"`.
- Don't put a project colour on chrome that isn't about that project.
