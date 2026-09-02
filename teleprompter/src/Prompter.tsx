import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Script, Settings } from './types'
import { normalizeWord, similarity } from './fuzzy'
import { speechAvailable, useSpeechWords } from './useSpeech'

interface Props {
  script: Script
  settings: Settings
  onSettingsChange: (patch: Partial<Settings>) => void
  onExit: () => void
}

interface Token {
  raw: string
  norm: string
  index: number
}

const SPEED_STEP = 10
const SPEED_MIN = 10
const SPEED_MAX = 400
const JUMP_SECONDS = 3
const IDLE_HIDE_MS = 3000
/** how confident a fuzzy match must be before we move the scroll target */
const MATCH_THRESHOLD = 0.7

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'take'
}

function pickMimeType(): string | undefined {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  if (typeof MediaRecorder === 'undefined') return undefined
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

export default function Prompter({ script, settings, onSettingsChange, onExit }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const moverRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [playing, setPlaying] = useState(false)
  const [idleHidden, setIdleHidden] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [geom, setGeom] = useState({ stageH: 0, textH: 0 })

  const [cameraOn, setCameraOn] = useState(false)
  const [hasMic, setHasMic] = useState(false)
  const [streamReady, setStreamReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordingName, setRecordingName] = useState('take.webm')
  const [voiceOn, setVoiceOn] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeShown = useRef(new Set<string>())

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const offsetRef = useRef(0)
  const maxOffsetRef = useRef(0)
  const markerYRef = useRef(0)
  const speedRef = useRef(settings.speed)
  const voiceTargetRef = useRef<number | null>(null)
  const cursorRef = useRef(0)

  const markerY = geom.stageH * settings.markerPos
  const maxOffset = geom.textH

  // the rAF loop reads these instead of re-subscribing on every settings change
  useLayoutEffect(() => {
    markerYRef.current = markerY
    maxOffsetRef.current = maxOffset
    speedRef.current = settings.speed
  }, [markerY, maxOffset, settings.speed])

  /** show a short, non-blocking message at most once per session */
  const quietNotice = useCallback((message: string) => {
    if (noticeShown.current.has(message)) return
    noticeShown.current.add(message)
    setNotice(message)
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 6000)
  }, [])

  // ---------------------------------------------------------------- document

  const doc = useMemo(() => {
    let index = 0
    const lines = script.body.split('\n').map((line) =>
      line
        .split(/\s+/)
        .filter(Boolean)
        .map<Token>((raw) => ({ raw, norm: normalizeWord(raw), index: index++ })),
    )
    return { lines, tokens: lines.flat() }
  }, [script.body])

  // ------------------------------------------------------------- measurement

  useEffect(() => {
    const stage = stageRef.current
    const body = bodyRef.current
    if (!stage || !body) return
    const measure = () => {
      setGeom({ stageH: stage.clientHeight, textH: body.offsetHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    observer.observe(body)
    return () => observer.disconnect()
  }, [script.id, settings.fontSize, settings.lineHeight, settings.textWidth])

  // --------------------------------------------------------------- scrolling

  const paint = useCallback(() => {
    const mover = moverRef.current
    if (mover) mover.style.transform = `translate3d(0, ${-offsetRef.current}px, 0)`
    const bar = progressRef.current
    if (bar) {
      const max = maxOffsetRef.current
      bar.style.transform = `scaleX(${max > 0 ? offsetRef.current / max : 0})`
    }
  }, [])

  const setOffset = useCallback(
    (next: number) => {
      offsetRef.current = clamp(next, 0, maxOffsetRef.current)
      paint()
    },
    [paint],
  )

  useEffect(() => {
    setOffset(offsetRef.current)
  }, [maxOffset, markerY, setOffset])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const speed = speedRef.current
      let velocity = speed

      const target = voiceTargetRef.current
      if (target !== null) {
        // ease toward the word we just heard instead of snapping to it
        const error = target - offsetRef.current
        velocity = clamp(speed + error * 1.2, -speed, speed * 3 + 300)
      }

      const next = offsetRef.current + velocity * dt
      const max = maxOffsetRef.current
      if (next >= max) {
        offsetRef.current = max
        paint()
        setPlaying(false)
        return
      }
      offsetRef.current = Math.max(0, next)
      paint()
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, paint])

  const togglePlay = useCallback(() => {
    setIdleHidden(false)
    setPlaying((value) => !value)
  }, [])

  const reset = useCallback(() => {
    voiceTargetRef.current = null
    cursorRef.current = 0
    setOffset(0)
  }, [setOffset])

  // ---------------------------------------------------------------- controls

  const changeSpeed = useCallback(
    (delta: number) => {
      onSettingsChange({ speed: clamp(settings.speed + delta, SPEED_MIN, SPEED_MAX) })
    },
    [onSettingsChange, settings.speed],
  )

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen().catch(() => {
        quietNotice('This browser would not go fullscreen.')
      })
    }
  }, [quietNotice])

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        // sliders are inputs too, but shortcuts should stay reliable while reading
        if (target.getAttribute('type') !== 'range') return
      }

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowUp':
          event.preventDefault()
          changeSpeed(SPEED_STEP)
          break
        case 'ArrowDown':
          event.preventDefault()
          changeSpeed(-SPEED_STEP)
          break
        case 'ArrowRight':
          event.preventDefault()
          setOffset(offsetRef.current + settings.speed * JUMP_SECONDS)
          voiceTargetRef.current = null
          break
        case 'ArrowLeft':
          event.preventDefault()
          setOffset(offsetRef.current - settings.speed * JUMP_SECONDS)
          voiceTargetRef.current = null
          break
        case 'r':
        case 'R':
          event.preventDefault()
          reset()
          break
        case 'm':
        case 'M':
          event.preventDefault()
          onSettingsChange({ mirror: !settings.mirror })
          break
        case 'f':
        case 'F':
          event.preventDefault()
          toggleFullscreen()
          break
        case 'Escape':
          // the browser already leaves fullscreen on Escape; only the second
          // press should drop back to the library
          if (!document.fullscreenElement) onExit()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    changeSpeed,
    onExit,
    onSettingsChange,
    reset,
    setOffset,
    settings.mirror,
    settings.speed,
    togglePlay,
    toggleFullscreen,
  ])

  // controls fade out while the scroll is running and the mouse is still
  useEffect(() => {
    if (!playing) return
    let timer = window.setTimeout(() => setIdleHidden(true), IDLE_HIDE_MS)
    const wake = () => {
      setIdleHidden(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdleHidden(true), IDLE_HIDE_MS)
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('mousedown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('mousedown', wake)
    }
  }, [playing])

  // ------------------------------------------------------------------ camera

  useEffect(() => {
    if (!cameraOn) return
    let cancelled = false

    const attach = (stream: MediaStream, mic: boolean) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      setStreamReady(true)
      setHasMic(mic)
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        void video.play().catch(() => undefined)
      }
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        quietNotice('This browser has no camera access here. Using a plain background.')
        setCameraOn(false)
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        })
        attach(stream, true)
      } catch {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          attach(stream, false)
        } catch {
          if (cancelled) return
          quietNotice('Camera access was declined. Using a plain background.')
          setCameraOn(false)
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      const stream = streamRef.current
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      const video = videoRef.current
      if (video) video.srcObject = null
      setStreamReady(false)
      setHasMic(false)
    }
  }, [cameraOn, quietNotice])

  // --------------------------------------------------------------- recording

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const startRecording = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
    const mimeType = pickMimeType()
    if (!mimeType) {
      quietNotice('This browser cannot record webm.')
      return
    }

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType })
    } catch {
      quietNotice('Recording could not start.')
      return
    }

    chunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []
      const name = `${slug(script.title)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`
      const url = URL.createObjectURL(blob)
      setRecordingUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return url
      })
      setRecordingName(name)
      setRecording(false)
      // hand the file straight over; the link below stays as a fallback
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
    }

    recorder.start(1000)
    recorderRef.current = recorder
    setRecording(true)
  }, [quietNotice, script.title])

  // stop the recorder if the camera goes away underneath it
  useEffect(() => {
    if (!cameraOn && recording) stopRecording()
  }, [cameraOn, recording, stopRecording])

  useEffect(
    () => () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    },
    [],
  )

  useEffect(
    () => () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl)
    },
    [recordingUrl],
  )

  // ---------------------------------------------------------- voice tracking

  const handleWords = useCallback(
    (heard: string[]) => {
      const tokens = doc.tokens
      if (tokens.length === 0) return
      const tail = heard.map(normalizeWord).filter(Boolean).slice(-3)
      if (tail.length === 0) return

      const cursor = cursorRef.current
      const from = Math.max(0, cursor - 8)
      const to = Math.min(tokens.length, cursor + 60)

      let best = -1
      let bestScore = 0
      for (let j = from; j < to; j++) {
        const head = similarity(tail[tail.length - 1], tokens[j].norm)
        if (head < 0.6) continue
        let score = head
        let weight = 1
        for (let k = 2; k <= tail.length; k++) {
          const back = j - (k - 1)
          if (back < 0) break
          score += 0.6 * similarity(tail[tail.length - k], tokens[back].norm)
          weight += 0.6
        }
        score /= weight
        if (j >= cursor) score += 0.05 // prefer moving forward through the script
        if (score > bestScore) {
          bestScore = score
          best = j
        }
      }

      if (best < 0 || bestScore < MATCH_THRESHOLD) return
      cursorRef.current = best
      const element = bodyRef.current?.querySelector<HTMLElement>(`[data-i="${best}"]`)
      if (element) {
        voiceTargetRef.current = element.offsetTop + element.offsetHeight / 2 - markerYRef.current
      }
    },
    [doc.tokens],
  )

  const handleVoiceError = useCallback(
    (message: string) => {
      quietNotice(message)
      setVoiceOn(false)
      voiceTargetRef.current = null
    },
    [quietNotice],
  )

  useSpeechWords(voiceOn, { onWords: handleWords, onError: handleVoiceError })

  useEffect(() => {
    if (!voiceOn) voiceTargetRef.current = null
  }, [voiceOn])

  // -------------------------------------------------------------------- view

  const hidden = playing && idleHidden

  return (
    <div className={`prompter${hidden ? ' controls-hidden' : ''}`}>
      <div className="stage" ref={stageRef} onClick={togglePlay}>
        <video
          ref={videoRef}
          className="camera-layer"
          style={{ opacity: cameraOn ? settings.cameraOpacity : 0 }}
          muted
          playsInline
        />

        <div className="text-layer" style={{ transform: settings.mirror ? 'scaleX(-1)' : 'none' }}>
          <div className="mover" ref={moverRef}>
            <div style={{ height: markerY }} />
            <div
              className="text-body"
              ref={bodyRef}
              style={{
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                maxWidth: `${settings.textWidth}px`,
              }}
            >
              {doc.lines.map((words, lineIndex) =>
                words.length === 0 ? (
                  <div className="line blank" key={`blank-${lineIndex}`} />
                ) : (
                  <div className="line" key={`line-${lineIndex}`}>
                    {words.map((token) => (
                      <span key={token.index} data-i={token.index}>
                        {token.raw}{' '}
                      </span>
                    ))}
                  </div>
                ),
              )}
            </div>
            <div style={{ height: Math.max(0, geom.stageH - markerY) }} />
          </div>
        </div>

        <div className="marker" style={{ top: markerY }} aria-hidden="true">
          <span className="marker-arrow left" />
          <span className="marker-arrow right" />
        </div>

        <div className="progress">
          <div className="progress-fill" ref={progressRef} />
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}

      <div className="topbar bar">
        <button type="button" className="btn ghost" onClick={onExit}>
          ← Library
        </button>
        <span className="now-playing">{script.title}</span>
        <span className="muted small">{isFullscreen ? 'Fullscreen' : ''}</span>
      </div>

      <div className="controlbar bar">
        <div className="control-row">
          <button
            type="button"
            className="btn primary wide"
            onClick={togglePlay}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="btn" onClick={reset}>
            Reset
          </button>
          <button
            type="button"
            className={`btn${settings.mirror ? ' on' : ''}`}
            onClick={() => onSettingsChange({ mirror: !settings.mirror })}
          >
            Mirror
          </button>
          <button type="button" className="btn" onClick={toggleFullscreen}>
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
          <button
            type="button"
            className={`btn${cameraOn ? ' on' : ''}`}
            onClick={() => setCameraOn((value) => !value)}
          >
            Camera
          </button>
          <button
            type="button"
            className={`btn${recording ? ' on recording' : ''}`}
            disabled={!cameraOn || !streamReady}
            onClick={() => (recording ? stopRecording() : startRecording())}
          >
            {recording ? 'Stop recording' : `Record${hasMic ? '' : ' (no mic)'}`}
          </button>
          {speechAvailable && (
            <button
              type="button"
              className={`btn${voiceOn ? ' on' : ''}`}
              onClick={() => setVoiceOn((value) => !value)}
              title="Follows your voice and nudges the scroll to the word you just said"
            >
              Voice tracking <span className="tag">experimental</span>
            </button>
          )}
          {recordingUrl && (
            <a className="btn link" href={recordingUrl} download={recordingName}>
              Save last take
            </a>
          )}
        </div>

        <div className="control-row sliders">
          <label>
            <span>Speed <b>{settings.speed}</b> px/s</span>
            <input
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={5}
              value={settings.speed}
              onChange={(event) => onSettingsChange({ speed: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Font <b>{settings.fontSize}</b> px</span>
            <input
              type="range"
              min={24}
              max={180}
              step={2}
              value={settings.fontSize}
              onChange={(event) => onSettingsChange({ fontSize: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Line height <b>{settings.lineHeight.toFixed(2)}</b></span>
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.05}
              value={settings.lineHeight}
              onChange={(event) => onSettingsChange({ lineHeight: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Text width <b>{settings.textWidth}</b> px</span>
            <input
              type="range"
              min={400}
              max={2000}
              step={20}
              value={settings.textWidth}
              onChange={(event) => onSettingsChange({ textWidth: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Reading line <b>{Math.round(settings.markerPos * 100)}</b>%</span>
            <input
              type="range"
              min={0.05}
              max={0.85}
              step={0.01}
              value={settings.markerPos}
              onChange={(event) => onSettingsChange({ markerPos: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Camera <b>{Math.round(settings.cameraOpacity * 100)}</b>%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.cameraOpacity}
              onChange={(event) => onSettingsChange({ cameraOpacity: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="hint muted small">
          Space play/pause · ↑↓ speed · ←→ jump {JUMP_SECONDS}s · R reset · M mirror · F fullscreen · Esc back
        </div>
      </div>
    </div>
  )
}
