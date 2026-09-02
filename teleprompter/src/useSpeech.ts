import { useEffect, useRef } from 'react'

/*
 * Minimal local typings for the Web Speech API. It is still vendor prefixed in
 * most browsers, so we look it up off `window` rather than relying on lib.dom.
 */
interface SpeechAlternative { transcript: string }
interface SpeechResult { readonly length: number; isFinal: boolean; [index: number]: SpeechAlternative }
interface SpeechResultList { readonly length: number; [index: number]: SpeechResult }
interface SpeechResultEvent { resultIndex: number; results: SpeechResultList }
interface SpeechErrorEvent { error: string }

interface Recognizer {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
}

type RecognizerCtor = new () => Recognizer

function getRecognizerCtor(): RecognizerCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognizerCtor
    webkitSpeechRecognition?: RecognizerCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** True when this browser exposes SpeechRecognition at all. */
export const speechAvailable = getRecognizerCtor() !== null

interface Options {
  /** called with the freshly heard words of the current utterance */
  onWords: (words: string[]) => void
  /** called with a human readable reason when recognition gives up */
  onError: (message: string) => void
}

/**
 * Runs continuous speech recognition while `enabled` is true and reports the
 * words of each (interim or final) result. Chrome ends recognition on its own
 * after a pause, so we restart it until the caller turns it off.
 */
export function useSpeechWords(enabled: boolean, options: Options): void {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    if (!enabled) return
    const Ctor = getRecognizerCtor()
    if (!Ctor) return

    let stopped = false
    let restartTimer = 0
    const recognizer = new Ctor()
    recognizer.lang = navigator.language || 'en-US'
    recognizer.continuous = true
    recognizer.interimResults = true
    recognizer.maxAlternatives = 1

    recognizer.onresult = (event) => {
      const words: string[] = []
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.length > 0) {
          words.push(...result[0].transcript.trim().split(/\s+/).filter(Boolean))
        }
      }
      if (words.length > 0) optionsRef.current.onWords(words)
    }

    recognizer.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        stopped = true
        optionsRef.current.onError('Microphone access was denied, so voice tracking is off.')
        return
      }
      optionsRef.current.onError(`Voice tracking stopped: ${event.error}.`)
    }

    recognizer.onend = () => {
      if (stopped) return
      restartTimer = window.setTimeout(() => {
        try {
          recognizer.start()
        } catch {
          // already running, or the engine refused a restart
        }
      }, 300)
    }

    try {
      recognizer.start()
    } catch {
      optionsRef.current.onError('Voice tracking could not start.')
    }

    return () => {
      stopped = true
      window.clearTimeout(restartTimer)
      recognizer.onresult = null
      recognizer.onerror = null
      recognizer.onend = null
      try {
        recognizer.abort()
      } catch {
        // nothing to abort
      }
    }
  }, [enabled])
}
