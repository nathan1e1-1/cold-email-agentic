import type { Thread } from '../domain/types'
import { formatDate } from '../lib/format'

interface Props {
  threads: Thread[]
  busy: boolean
  ready: boolean
  loading: boolean
  overflowed: boolean
  hasMore: boolean
  onLoadMore: () => void
  onRestore: (id: string) => void
}

export function TrashView({ threads, busy, ready, loading, overflowed, hasMore, onLoadMore, onRestore }: Props) {
  return (
    <div className="view">
      <h1 className="view-title">Trash</h1>
      <p className="view-sub">Deleted outreach threads. Restore one to put it back in the Inbox. Gmail permanently empties Trash after 30 days.</p>
      {!ready ? (
        <p className="hint">Connect Gmail to view Trash.</p>
      ) : loading ? (
        <p className="hint">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="hint">Trash is empty.</p>
      ) : (
        <ul className="trash-list">
          {threads.map((t) => (
            <li key={t.id} className="trash-row">
              <div className="trash-main">
                <span className="trash-subject">{t.subject || '(no subject)'}</span>
                <span className="trash-meta">
                  {t.participants.map((p) => p.name ?? p.email).join(', ')} · {formatDate(t.lastMessageAt)}
                </span>
              </div>
              <div className="trash-actions">
                <button
                  type="button"
                  className="chip ghost"
                  disabled={busy}
                  aria-label={`Restore ${t.subject || 'thread'}`}
                  onClick={() => onRestore(t.id)}
                >
                  Restore
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {overflowed && <p className="hint">Showing the newest replies.</p>}
      {ready && hasMore && (
        <div className="load-more">
          <button type="button" className="chip ghost" disabled={busy} onClick={onLoadMore}>
            {busy ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
