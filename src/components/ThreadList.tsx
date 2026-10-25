import { useState } from 'react'
import type { Thread } from '../domain/types'
import { formatDate } from '../lib/format'
import { Avatar } from './Avatar'

function senderLabel(thread: Thread): string {
  const last = thread.messages.at(-1)
  if (!last) return 'Unknown'
  return last.direction === 'outbound' ? 'You' : last.from.name ?? last.from.email
}

export type InboxMode = 'outreach' | 'all';

interface Props {
  threads: Thread[]
  selectedId: string | null
  onSelect: (id: string) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  mode: InboxMode
  onModeChange: (mode: InboxMode) => void
  emptyText: string
  overflowed: boolean
  loading: boolean
}

export function ThreadList({ threads, selectedId, onSelect, hasMore, loadingMore, onLoadMore, mode, onModeChange, emptyText, overflowed, loading }: Props) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const visible = q
    ? threads.filter((t) => {
        const last = t.messages.at(-1)
        const sender = (last?.from.name ?? last?.from.email ?? '').toLowerCase()
        return sender.includes(q) || t.subject.toLowerCase().includes(q) || t.snippet.toLowerCase().includes(q)
      })
    : threads

  return (
    <aside className="list">
      <div className="list-head">
        {mode === 'outreach' ? 'Outreach replies' : 'Inbox'} <span className="count">{visible.length}</span>
      </div>
      <div className="list-search mode-toggle">
        <button
          type="button"
          aria-pressed={mode === 'outreach'}
          className={mode === 'outreach' ? 'chip active' : 'chip ghost'}
          onClick={() => onModeChange('outreach')}
        >
          Outreach replies
        </button>
        <button
          type="button"
          aria-pressed={mode === 'all'}
          className={mode === 'all' ? 'chip active' : 'chip ghost'}
          onClick={() => onModeChange('all')}
        >
          All mail
        </button>
      </div>
      <div className="list-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sender or subject…"
          aria-label="Search threads"
        />
      </div>
      {overflowed && <p className="hint">Showing the newest replies.</p>}
      <ul>
        {visible.map((t) => {
          const label = senderLabel(t)
          return (
            <li key={t.id}>
              <button
                type="button"
                className={t.id === selectedId ? 'thread selected' : 'thread'}
                onClick={() => onSelect(t.id)}
              >
                <Avatar name={label} />
                <span className="thread-main">
                  <span className="thread-top">
                    <span className="thread-sender">{label}</span>
                    <span className="thread-date">{formatDate(t.lastMessageAt)}</span>
                  </span>
                  <span className="thread-subject">{t.subject}</span>
                  <span className="thread-snippet">{t.snippet}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {visible.length === 0 && !loading && <p className="hint">{threads.length === 0 ? emptyText : 'No matches.'}</p>}
      {hasMore && (
        <div className="load-more">
          <button type="button" className="chip ghost" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </aside>
  )
}
