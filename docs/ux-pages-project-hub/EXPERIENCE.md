---
name: vibe
status: draft
created: 2026-11-20T01:13:13Z
updated: 2026-11-20T01:13:13Z
sources:
  - ../plans/2026-11-20-1102-feat-pages-project-hub-plan.md
---

# vibe — Experience Spine

## Foundation

A static website on GitHub Pages at `https://alifa20.github.io/vibe/`. It has no UI framework and no client-side JavaScript. The hub, the project pages and the 404 page are plain HTML rendered at build time from `site/projects.json`, and the nav strip is an HTML and CSS block injected into the built demos. Visual identity: [DESIGN.md](DESIGN.md). Mechanism lives in the plan's KTDs, and this spine does not override them.

The main visitor is Ali, using it as a personal index to jump between their own experiments. The second visitor is anyone Ali shares the link with.

## Information Architecture

| Surface | URL | Reached from | Purpose |
|---|---|---|---|
| Hub | `/vibe/` | Shared link, README, "← vibe" in the nav strip, 404 | See all eight projects at a glance and open one |
| Live demo × 2 | `/vibe/teleprompter/`, `/vibe/carrd/` | Hub card, nav switcher, prev/next | Use the real app in the browser, with the nav strip on top |
| Project page × 6 | `/vibe/bitly/`, `/vibe/linktree/`, `/vibe/qr/`, `/vibe/senja/`, `/vibe/tally/`, `/vibe/zcal/` | Hub card, nav switcher, prev/next | See what a server app does (screenshots and features), and copy the commands to run it |
| 404 | any missing `/vibe/*` | Bad link | Get back to the hub |
| Source | `github.com/alifa20/vibe/tree/main/<slug>` (external) | Project page source button, switcher menu footer | Read the code |

Every project has a sub-page, so every hub card goes to `/vibe/<slug>/`. This changes plan R3 and its scope boundary, which say server-app cards link to GitHub. Order everywhere follows the manifest: live demos first, then server apps.

**Hub layout is still open.** Grouped ("live demos" 2 + "run it yourself" 6) vs single grid, both shown in [mockups/key-hub.html](mockups/key-hub.html) (8 cards, the badge carries the difference). The user decides after comparing the key-screen mockups.

## Voice and Tone

Lowercase, short, a maker's log. It owns the fact that these were built with AI. It never sells.

| Do | Don't |
|---|---|
| "vibe — eight things I built with AI" | "Welcome to my portfolio of innovative projects!" |
| "live demo" / "needs a server" | "Try it now!" / "Unavailable" |
| "run it yourself" | "Self-hosting instructions" |
| "inspired by Bitly" | "A Bitly clone" |
| "copied ✓" | "Copied to clipboard successfully" |
| "404 — nothing here. ← back to vibe" | "Error 404: The requested page could not be found." |
| "you're here" | "Current selection" |

Project names stay as written in the manifest: golinks, linkinbio, qrforge, forms, personal-site, zcal, senja, teleprompter.

## Component Patterns

| Component | Where | Behaviour |
|---|---|---|
| Project card | Hub | The whole card is one `<a>` to `/vibe/<slug>/`, with nothing clickable nested inside it. The accessible name is "<name>, <status>, <description>". The source link is not on the card; it lives on the sub-page. |
| Status badge | Card, project band | It is text, not colour alone: "live demo" or "needs a server". |
| Nav strip | Every page under `/vibe/<slug>/` | It holds "← vibe" (to the hub), the prev and next steps (manifest order, wrapping around), and the switcher. It sits in the page flow, above the app. It is not fixed or sticky. |
| Nav switcher | Nav strip | A native `<details>`/`<summary>`, so it needs no JS. It opens a menu grouped "live demos" / "run it yourself". The current project is `aria-current="page"` and shows "you're here". The menu footer has "source on github ↗" for the current project. [ASSUMPTION] On live demos this is the only route to the source, since they have no project page. |
| Terminal block | Project page | Commands are selectable plain text in a `<pre>`. The "copy" button is a progressive enhancement. With JS it copies the whole block and shows "copied ✓" for 2 seconds. Without JS it is hidden, and the text can still be selected. [ASSUMPTION] A tiny inline script is acceptable on project pages, which have no CSP. Otherwise drop the button. |
| Screenshot frame | Project page | Holds `<img>` with real alt text ("zcal booking page showing open slots for Thursday"). The first frame is large, and up to two more sit below it. Clicking opens the full-size image file. There is no lightbox. |
| Source button | Project page | An external link to the project folder on GitHub. It opens in the same tab. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Switcher open | Nav strip | The menu overlays the top of the app. It closes on choosing a project (navigation), clicking the summary again, or Escape (native `<details>` behaviour where it exists). |
| Prompter running | Teleprompter | The prompter's full-screen overlay covers the strip (plan AE1). The strip comes back when the prompter exits. |
| Hover / focus / press | Cards, pills, buttons | Hover lifts, press pushes in, and keyboard focus shows a 3px dashed outline (DESIGN.md Elevation). Focus and hover look different from each other. |
| Screenshot not captured yet | Project page | The hatched placeholder frame shows its label. [ASSUMPTION] It never ships. Every server app needs at least one real capture before launch. |
| Missing path | 404 | "404 — nothing here" with one "← back to vibe" button. There is no nav strip, because no project is current. |
| No JS | All | Everything works except the copy button, which hides. |

## Interaction Primitives

- Plain links and one native disclosure (`<details>`). There is no client routing, transition animation or scroll hijacking.
- Hover and press movement is a 120ms transform. With `prefers-reduced-motion: reduce`, nothing moves; only the shadow changes.
- The keyboard order on sub-pages is: "← vibe" → prev → switcher → next → app content. A skip link, "skip to <name>", sits before the strip on project pages and demos.

## Accessibility Floor

- The nav strip is `<nav aria-label="vibe projects">`. The switcher summary reads "switch project, current: <name>". The prev and next links read "previous: <name>" and "next: <name>".
- Tap targets are at least 44×44px everywhere. The strip fits on one line at 375px.
- Status never relies on colour alone, since the project colours are decorative identity.
- Every text and background pairing meets WCAG AA in both schemes. Ink on each project colour is checked in the build test.
- Visible `:focus-visible` on every interactive element, never removed.
- Screenshot `alt` text describes what the screen shows, not "screenshot".

## Responsive & Platform

| Width | Behaviour |
|---|---|
| ≥ 900px | Hub: 2-up live demos and 3-up server apps (grouped), or 4-up (single grid). Project page: band plus a 2-column body. The strip shows the crumb and the step labels. |
| 600–899px | Hub: 2-up for every group. Project page: the body stacks, with screenshots first. |
| < 600px | Hub: 1 column, the "→" is hidden and the section explainers are hidden. Project band stacks. The strip is `← vibe ‹ [● name ▾] ›` only, and the switcher menu is full-width under the strip. |

Light and dark follow `prefers-color-scheme`. The nav strip looks the same in both.

## Mockups

The [hub](mockups/key-hub.html) (both layouts plus the 404), the [project page](mockups/key-project-page.html) (zcal light and phone dark, golinks dark) and the [nav strip](mockups/key-nav-strip.html) (teleprompter, switcher open, anatomy, personal-site, prompter covering the strip). These spines win over the mockups when they conflict. The personal-site stand-in's bio text is invented filler, not content for R10.

## Inspiration & Anti-patterns

- **Keep:** a sticker sheet or zine (flat colour, outlines, hard shadows). Each project's colour is its identity.
- **Rejected:** the draft `docs/index.html` look (dark, mint, rounded cards), and the terminal, notebook and index directions (see `.working/direction-*.html`).
- **Anti-pattern:** a nav strip that floats over or hides app controls (R5). The same for an iframe shell (plan KTD3).

## Key Flows

### Flow 1 — "which one was the scheduling one?" (Ali, Sunday evening, on a phone on the couch)

1. Ali opens `alifa20.github.io/vibe/` from a home-screen bookmark.
2. They scroll the stacked cards and spot the light-blue **zcal** sticker with its dashed "needs a server" badge.
3. They tap the card, and `/vibe/zcal/` opens with the blue band and the "booking page" screenshot.
4. They scroll to **run it locally** and tap **copy**, which shows "copied ✓". They paste the commands into a note for tomorrow.
5. **Climax:** they tap **›** in the yellow strip, land on teleprompter, and are rehearsing a script in two taps without going back to the hub.

### Flow 2 — a shared link (Priya, a friend Ali DMed the link to, at a laptop on Friday)

1. Priya opens the hub. "vibe — eight things I built with AI" tells them what this is in one line.
2. They click **personal-site** (live demo), and the real site loads under the yellow strip.
3. They open the switcher, see the two groups, and pick **senja**.
4. **Climax:** the senja project page shows what it does in three screenshots and four tiles, so they get it without installing anything. They click **source on github ↗**.

## Open Questions

- **Hub layout:** grouped or single grid. Blocks the hub template (plan U1).
- **Screenshots:** who captures them, at what size, and where they live (e.g. `<slug>/docs/screenshots/*.png` read by the manifest). Blocks the project pages.
- **Shared yellow:** `#ffd23f` is both vibe's own colour (nav strip, wordmark) and personal-site's project colour. On the personal-site demo the strip, its switcher dot and its menu fill are all the same yellow. Either give personal-site a new colour or accept it.
- **Plan changes:** R3, the Scope Boundaries and the Deferred list need updating for project pages, and a new unit is needed. That is ce-plan's job, not this spine's.
