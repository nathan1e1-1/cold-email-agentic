import type { Thread } from '../domain/types'
import { formatDate } from '../lib/format'

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

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
    <div className="view trash-view">
      <header className="page-head">
        <div className="page-head-main">
          <h1 className="view-title">Trash</h1>
          <p className="view-sub">Deleted outreach threads. Restore one to put it back in the Inbox. Your mail provider permanently empties Trash after its retention period.</p>
        </div>
      </header>
      {!ready ? (
        <p className="hint">Connect a mail account to view Trash.</p>
      ) : loading ? (
        <p className="hint">Loading…</p>
      ) : threads.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true"><TrashIcon /></span>
          <p className="muted">Trash is empty.</p>
        </div>
      ) : (
        <ul className="trash-list">
          {threads.map((t) => (
            <li key={t.id} className="trash-row">
              <span className="trash-icon" aria-hidden="true"><TrashIcon /></span>
              <div className="trash-main">
                <span className="trash-subject">{t.subject || '(no subject)'}</span>
                <span className="trash-meta">
                  {t.participants.map((p) => p.name ?? p.email).join(', ')} · {formatDate(t.lastMessageAt)}
                </span>
              </div>
              <div className="trash-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
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
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onLoadMore}>
            {busy ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
