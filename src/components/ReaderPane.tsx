import type { Address, Thread } from '../domain/types'
import { formatDate } from '../lib/format'
import { Avatar } from './Avatar'

function addr(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

export function ReaderPane({ thread }: { thread: Thread }) {
  return (
    <div className="email-thread">
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
