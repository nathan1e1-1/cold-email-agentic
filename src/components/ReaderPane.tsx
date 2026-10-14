import type { Thread } from '../domain/types'
import { formatDate } from '../lib/format'

export function ReaderPane({ thread }: { thread: Thread }) {
  return (
    <>
      <div className="reader-head">
        <h1>{thread.subject}</h1>
        <p className="participants">
          {thread.participants.map((p) => p.name ?? p.email).join(', ')}
        </p>
      </div>
      <ol className="messages">
        {thread.messages.map((m) => (
          <li key={m.id} className={`message ${m.direction}`}>
            <div className="message-meta">
              <span className="message-from">{m.direction === 'outbound' ? 'You' : m.from.name ?? m.from.email}</span>
              <span className="message-date">{formatDate(m.date)}</span>
            </div>
            <div className="message-body">{m.bodyText}</div>
          </li>
        ))}
      </ol>
    </>
  )
}
