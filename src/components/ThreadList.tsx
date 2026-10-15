import type { Thread } from '../domain/types'
import { formatDate } from '../lib/format'
import { Avatar } from './Avatar'

function senderLabel(thread: Thread): string {
  const last = thread.messages.at(-1)
  if (!last) return 'Unknown'
  return last.direction === 'outbound' ? 'You' : last.from.name ?? last.from.email
}

interface Props {
  threads: Thread[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ThreadList({ threads, selectedId, onSelect }: Props) {
  return (
    <aside className="list">
      <div className="list-head">
        Inbox <span className="count">{threads.length}</span>
      </div>
      <ul>
        {threads.map((t) => {
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
    </aside>
  )
}
