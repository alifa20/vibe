import { useCallback, useEffect, useState } from 'react'
import Library from './Library'
import Prompter from './Prompter'
import { loadScripts, loadSettings, newScript, saveScripts, saveSettings } from './storage'
import type { Script, Settings } from './types'

type View = 'library' | 'prompt'

function byNewest(a: Script, b: Script): number {
  return b.updatedAt - a.updatedAt
}

/*
 * Cached so the two lazy state initializers (and StrictMode's double invoke)
 * agree on the same seeded sample script.
 */
let initialScripts: Script[] | null = null
function readScripts(): Script[] {
  if (!initialScripts) initialScripts = loadScripts().sort(byNewest)
  return initialScripts
}

export default function App() {
  const [scripts, setScripts] = useState<Script[]>(readScripts)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [selectedId, setSelectedId] = useState<string | null>(() => readScripts()[0]?.id ?? null)
  const [view, setView] = useState<View>('library')

  useEffect(() => {
    saveScripts(scripts)
  }, [scripts])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  const handleSave = useCallback((id: string, patch: { title?: string; body?: string }) => {
    setScripts((current) => {
      const target = current.find((script) => script.id === id)
      if (!target) return current
      const title = patch.title ?? target.title
      const body = patch.body ?? target.body
      if (title === target.title && body === target.body) return current
      return current.map((script) =>
        script.id === id ? { ...script, title, body, updatedAt: Date.now() } : script,
      )
    })
  }, [])

  const handleCreate = useCallback(() => {
    const script = newScript()
    setScripts((current) => [script, ...current])
    setSelectedId(script.id)
  }, [])

  const handleDelete = useCallback((id: string) => {
    setScripts((current) => current.filter((script) => script.id !== id))
  }, [])

  // fall back to the newest script so a delete never leaves a dangling selection
  const selected = scripts.find((script) => script.id === selectedId) ?? scripts[0] ?? null

  if (view === 'prompt' && selected) {
    return (
      <Prompter
        key={selected.id}
        script={selected}
        settings={settings}
        onSettingsChange={updateSettings}
        onExit={() => setView('library')}
      />
    )
  }

  return (
    <Library
      scripts={scripts}
      selectedId={selected?.id ?? null}
      onSelect={setSelectedId}
      onCreate={handleCreate}
      onDelete={handleDelete}
      onSave={handleSave}
      onPrompt={(id) => {
        setSelectedId(id)
        setView('prompt')
      }}
    />
  )
}
