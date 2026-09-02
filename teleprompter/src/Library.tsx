import { useState } from 'react'
import type { Script } from './types'

interface Props {
  scripts: Script[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  /** commit an edited title/body; called on blur and before entering the prompt view */
  onSave: (id: string, patch: { title?: string; body?: string }) => void
  onPrompt: (id: string) => void
}

type EditorProps = Pick<Props, 'onSave' | 'onDelete' | 'onPrompt'> & { script: Script }

const WORDS_PER_MINUTE = 150

function stats(body: string): string {
  const words = body.split(/\s+/).filter(Boolean).length
  if (words === 0) return 'Empty'
  const minutes = words / WORDS_PER_MINUTE
  const spoken = minutes < 1 ? `${Math.round(minutes * 60)} sec` : `${Math.round(minutes)} min`
  return `${words} words · about ${spoken} spoken`
}

/**
 * Keyed on the script id by its parent, so switching scripts remounts it with
 * fresh draft state instead of syncing props into state.
 */
function ScriptEditor({ script, onSave, onDelete, onPrompt }: EditorProps) {
  const [title, setTitle] = useState(script.title)
  const [body, setBody] = useState(script.body)

  function flush() {
    onSave(script.id, { title: title.trim() || 'Untitled script', body })
  }

  return (
    <>
      <div className="editor-head">
        <input
          className="title-input"
          value={title}
          aria-label="Script title"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={flush}
        />
        <div className="editor-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              flush()
              onPrompt(script.id)
            }}
          >
            Open prompter
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              if (confirm(`Delete "${script.title}"? This cannot be undone.`)) {
                onDelete(script.id)
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <textarea
        className="body-input"
        value={body}
        aria-label="Script body"
        spellCheck
        placeholder="Type or paste your script here. Blank lines become paragraph breaks in the prompter."
        onChange={(event) => setBody(event.target.value)}
        onBlur={flush}
      />

      <footer className="editor-foot muted">
        <span>{stats(body)}</span>
        <span>Saved when you click away from the field.</span>
      </footer>
    </>
  )
}

export default function Library({
  scripts,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  onSave,
  onPrompt,
}: Props) {
  const selected = scripts.find((script) => script.id === selectedId) ?? null

  return (
    <div className="library">
      <header className="library-head">
        <h1>Teleprompter</h1>
        <p className="muted">Scripts are saved in this browser only. Nothing is uploaded anywhere.</p>
      </header>

      <div className="library-body">
        <aside className="list-pane">
          <div className="list-head">
            <span className="label">Scripts</span>
            <button type="button" className="btn small" onClick={onCreate}>
              New
            </button>
          </div>
          <ul className="script-list">
            {scripts.map((script) => (
              <li key={script.id}>
                <button
                  type="button"
                  className={`script-item${script.id === selectedId ? ' active' : ''}`}
                  onClick={() => onSelect(script.id)}
                >
                  <span className="script-title">{script.title}</span>
                  <span className="script-meta">{new Date(script.updatedAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="editor-pane">
          {selected ? (
            <ScriptEditor
              key={selected.id}
              script={selected}
              onSave={onSave}
              onDelete={onDelete}
              onPrompt={onPrompt}
            />
          ) : (
            <div className="empty">
              <p>No script yet.</p>
              <button type="button" className="btn primary" onClick={onCreate}>
                Create one
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
