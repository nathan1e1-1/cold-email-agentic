import { useState } from 'react'
import type { Thread } from '../domain/types'
import { formatDate } from '../lib/format'
import { Avatar } from './Avatar'

function senderLabel(thread: Thread): string {
  const last = thread.messages.at(-1)
  if (!last) return 'Unknown'
  return last.direction === 'outbound' ? 'You' : last.from.name ?? last.from.email
}

function threadStatus(thread: Thread): { label: string; tone: string } {
  const last = thread.messages.at(-1)
  if (last?.direction === 'inbound') return { label: 'Replied', tone: 'replied' }
  return { label: 'Sent', tone: 'sent' }
}

function SearchIcon() {
  return (
    <svg
      className="search-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.5" y2="16.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

interface Props {
  threads: Thread[]
  selectedId: string | null
  onSelect: (id: string) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onCompose: () => void
  emptyText: string
  overflowed: boolean
  loading: boolean
}

export function ThreadList({ threads, selectedId, onSelect, hasMore, loadingMore, onLoadMore, onCompose, emptyText, overflowed, loading }: Props) {
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
        <div className="list-head-main">
          <span className="list-title">Outreach Inbox</span>
          <span className="count">{visible.length}</span>
        </div>
        <button type="button" className="btn btn-primary btn-sm new-email" onClick={onCompose}>
          <PlusIcon />
          New
        </button>
      </div>
      <div className="list-search">
        <SearchIcon />
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
          const status = threadStatus(t)
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
                  <span className="thread-foot">
                    <span className={`thread-status ${status.tone}`}>{status.label}</span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {visible.length === 0 && !loading && <p className="hint">{threads.length === 0 ? emptyText : 'No matches.'}</p>}
      {hasMore && (
        <div className="load-more">
          <button type="button" className="btn btn-secondary btn-sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </aside>
  )
}
