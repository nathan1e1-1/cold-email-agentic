import type { Thread } from '../domain/types'
import { formatDate } from '../lib/format'
import { Avatar } from './Avatar'

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
        {thread.messages.map((m) => {
          const who = m.direction === 'outbound' ? 'You' : m.from.name ?? m.from.email
          return (
            <li key={m.id} className={`message ${m.direction}`}>
              <Avatar name={who} />
              <div className="message-body-wrap">
                <div className="message-meta">
                  <span className="message-from">{who}</span>
                  <span className="message-date">{formatDate(m.date)}</span>
                </div>
                <div className="message-body">{m.bodyText}</div>
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}
