# Teleprompter

A local, single page teleprompter. Vite + React + TypeScript, plain CSS, no backend,
no accounts, no telemetry and no external API calls. Scripts and settings live in
`localStorage` on the machine you are using and never leave it.

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (http://localhost:5173 by default).

```bash
npm run build     # type check and produce a production bundle in dist/
npm run preview   # serve the production bundle locally
npm run lint      # oxlint
```

There is no `.env` file and nothing to configure: the app has no secrets and talks
to no services.

## The two views

**Library** — create, rename and delete scripts, and edit the body in a plain
textarea. Edits autosave when you click away from the title or the body field.
Each script is stored as `{ id, title, body, updatedAt }`. A sample script is
seeded the first time you open the app.

**Prompter** — a fullscreen scrolling display of the selected script. Scrolling is
driven by `requestAnimationFrame` at a speed measured in CSS pixels per second, not
by a CSS animation, so speed changes take effect immediately and mid-scroll jumps
are exact. Controls fade out after 3 seconds of mouse idle while the scroll is
running and come back on the next mouse move.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause the scroll |
| `↑` | Speed up by 10 px/s |
| `↓` | Slow down by 10 px/s |
| `→` | Jump forward 3 seconds of scroll |
| `←` | Jump back 3 seconds of scroll |
| `R` | Reset to the top |
| `M` | Toggle horizontal mirror |
| `F` | Toggle fullscreen |
| `Esc` | Leave fullscreen, or return to the library |

Clicking anywhere on the text also toggles play/pause.

`Esc` is handled in two steps because the browser owns the first one: while you are
in fullscreen it just leaves fullscreen, and the next press returns to the library.

## Reading line, type and mirror

The thin blue line across the stage is the reading line. Its vertical position is
adjustable, and the script is padded so that the first word starts on the line and
the last word can scroll up to it. Font size, line height and text column width are
all adjustable from the control bar.

Mirror mode applies `transform: scaleX(-1)` to the text layer only, for use with a
beam splitter rig. The control bar, the reading line and the camera layer are
outside that transform and stay readable.

## Camera layer

The **Camera** button asks for camera (and microphone) access with `getUserMedia`
and renders the preview behind the text at an adjustable opacity. The preview is
horizontally flipped so it reads as a mirror, which is what you expect of a self
view.

If permission is denied, or the browser exposes no camera API, the app quietly falls
back to a solid black background and says so once in a small notice that fades on
its own. Nothing else changes and no permission is asked for again until you press
the button.

## Recording

With the camera on, **Record** captures the camera and microphone stream with
`MediaRecorder` and writes a `.webm` file when you stop. The download starts
automatically, and a **Save last take** link stays in the control bar as a fallback
if the browser blocks it.

The recording is the raw camera and mic stream. The script text is deliberately not
composited into it — this is a prompter, not a video editor. If the microphone was
not granted, the button reads `Record (no mic)` and captures video only.

## Voice tracking (experimental)

Behind the **Voice tracking** toggle, the app uses the browser `SpeechRecognition`
API to listen while you read, fuzzy matches the words it hears against the upcoming
tokens in the script, and nudges the scroll position toward the word you just said
rather than snapping to it. Baseline scrolling continues underneath, so a dropout
in recognition slows you down instead of stopping you.

Matching normalizes case, accents and punctuation, scores candidates with a
Levenshtein-based similarity, and confirms a match against the previous two heard
words before it will move the target. It searches only a window around the current
position, so a repeated phrase elsewhere in the script will not throw it.

The toggle is hidden entirely in browsers that do not expose `SpeechRecognition`
(as of now, that means everything except Chromium-based browsers and Safari).
Recognition in Chrome sends audio to Google's speech service — that is the browser's
implementation, not something this app does, and it is the one reason to leave the
toggle off if you want a strictly offline session.

## What is persisted

Settings — speed, font size, line height, text width, mirror, camera opacity and
reading line position — are saved to `localStorage` and restored on load.

Camera, recording and voice tracking are deliberately **not** persisted. Nothing
should reach for your camera or microphone just because you reloaded the page.

Storage keys: `teleprompter.scripts.v1` and `teleprompter.settings.v1`.

## Camera and microphone need a secure context

`getUserMedia`, `MediaRecorder` and `SpeechRecognition` only work on a secure
origin. `http://localhost` counts as one, so `npm run dev` is fine. If you serve
the built app from another host — a LAN address, a NAS, another machine's IP — the
browser will refuse those APIs until it is behind HTTPS. Scrolling, scripts and
every keyboard shortcut work regardless.

## Out of scope

Multi device remote control, accounts, script sharing, burned-in captions and a
mobile native app are not part of this project.
