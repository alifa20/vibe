import type { Script, Settings } from './types'

const SCRIPTS_KEY = 'teleprompter.scripts.v1'
const SETTINGS_KEY = 'teleprompter.settings.v1'

export const DEFAULT_SETTINGS: Settings = {
  speed: 60,
  fontSize: 72,
  lineHeight: 1.4,
  textWidth: 1100,
  mirror: false,
  cameraOpacity: 0.35,
  markerPos: 0.4,
}

const SAMPLE_BODY = `Welcome to the teleprompter.

Everything here lives in your browser. There is no account, no server and
nothing leaves this machine.

Press space to start and stop the scroll. Use the up and down arrows to
change speed while you read, and the left and right arrows to jump three
seconds back or forward.

The thin line across the screen is your reading line. Keep your eyes on it
and let the words come to you. You can move it up or down in the controls.

Press M to mirror the text for a beam splitter rig. Press F for fullscreen.
Press R to go back to the top. Press Escape to come back to the library.

Turn on the camera layer to see yourself behind the words, and drop the
opacity until it sits quietly in the background. If you want a take on
disk, start a recording and a webm file will be saved when you stop.

That is the whole tool. Write your script, set your speed, and read.`

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function sampleScript(): Script {
  return { id: uid(), title: 'Sample script', body: SAMPLE_BODY, updatedAt: Date.now() }
}

function isScript(value: unknown): value is Script {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string'
    && typeof v.title === 'string'
    && typeof v.body === 'string'
    && typeof v.updatedAt === 'number'
}

export function loadScripts(): Script[] {
  try {
    const raw = localStorage.getItem(SCRIPTS_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const scripts = parsed.filter(isScript)
        if (scripts.length > 0) return scripts
      }
    }
  } catch {
    // corrupt or unavailable storage: fall through to the sample
  }
  const seeded = [sampleScript()]
  saveScripts(seeded)
  return seeded
}

export function saveScripts(scripts: Script[]): void {
  try {
    localStorage.setItem(SCRIPTS_KEY, JSON.stringify(scripts))
  } catch {
    // storage full or blocked: the session still works, it just will not persist
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        return { ...DEFAULT_SETTINGS, ...(parsed as Partial<Settings>) }
      }
    }
  } catch {
    // ignore and use defaults
  }
  return DEFAULT_SETTINGS
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

export function newScript(): Script {
  return { id: uid(), title: 'Untitled script', body: '', updatedAt: Date.now() }
}
