import type { Address, Thread } from '../domain/types'
import { formatDate } from '../lib/format'
import { Avatar } from './Avatar'

function addr(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

function contactFor(thread: Thread): Address | null {
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'inbound')
  if (lastInbound) return lastInbound.from
  return thread.participants[0] ?? null
}

export function ReaderPane({ thread, onTrash, trashBusy, onReply }: { thread: Thread; onTrash?: () => void; trashBusy?: boolean; onReply?: () => void }) {
  const contact = contactFor(thread)
  const contactName = contact?.name ?? contact?.email ?? 'Conversation'

  return (
    <div className="email-thread" role="region" aria-label="Email thread" tabIndex={0}>
      <div className="reader-head">
        <Avatar name={contactName} />
        <div className="reader-head-main">
          <h1 className="reader-contact">{contactName}</h1>
          <p className="reader-meta">
            {contact?.email ?? 'Unknown sender'}
            <span className="dot-sep" aria-hidden="true">·</span>
            {thread.messages.length} message{thread.messages.length === 1 ? '' : 's'}
          </p>
          <p className="reader-subject">{thread.subject}</p>
        </div>
        {(onReply || onTrash) && (
          <div className="reader-actions">
            {onReply && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onReply}>Reply</button>
            )}
            {onTrash && (
              <button
                type="button"
                className="chip ghost danger"
                disabled={trashBusy}
                aria-label="Move conversation to Trash"
                onClick={onTrash}
              >
                Trash
              </button>
            )}
          </div>
        )}
      </div>

      {thread.messages.map((m) => {
        const who = m.direction === 'outbound' ? 'You' : m.from.name ?? m.from.email
        return (
          <article key={m.id} className={`email-msg ${m.direction}`}>
            <header className="email-head">
              <Avatar name={who} />
              <div className="email-head-main">
                <div className="email-line">
                  <span className="email-from">
                    {who} <span className="email-addr">&lt;{m.from.email}&gt;</span>
                  </span>
                  <span className="email-date">{formatDate(m.date)}</span>
                </div>
                <div className="email-recipients">
                  to {m.to.map(addr).join(', ')}
                  {m.cc.length > 0 && <> · cc {m.cc.map(addr).join(', ')}</>}
                </div>
              </div>
            </header>
            <div className="email-body">{m.bodyText}</div>
          </article>
        )
      })}
    </div>
  )
}
