import type { Account } from '../domain/types'
import type { ActivityItem } from '../components/Sidebar'
import { formatDate } from '../lib/format'

interface Props {
  account: Account | null
  threadCount: number
  draftsThisSession: number
  sentThisSession: number
  activity: ActivityItem[]
  aiLabel: string | null
  aiPrivacy: 'may-use-content' | 'local' | null
  onOpenThread: (threadId: string) => void
  onGoInbox: () => void
}

export function DashboardView({
  account, threadCount, draftsThisSession, sentThisSession, activity, aiLabel, aiPrivacy, onOpenThread, onGoInbox,
}: Props) {
  return (
    <div className="view">
      <h1 className="view-title">Dashboard</h1>
      <p className="view-sub">
        {account ? `Connected as ${account.email}` : 'Connect Gmail to load your inbox.'}
      </p>

      <div className="stats">
        <div className="stat">
          <span className="stat-num">{threadCount}</span>
          <span className="stat-label">Threads loaded</span>
        </div>
        <div className="stat">
          <span className="stat-num">{draftsThisSession}</span>
          <span className="stat-label">Drafts this session</span>
        </div>
        <div className="stat">
          <span className="stat-num">{sentThisSession}</span>
          <span className="stat-label">Sent this session</span>
        </div>
        <div className="stat">
          <span className="stat-num">{aiLabel ?? '—'}</span>
          <span className="stat-label">
            AI provider{aiPrivacy ? ` · ${aiPrivacy === 'local' ? 'local' : 'may use content'}` : ''}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Recent activity</span>
        </div>
        {activity.length === 0 ? (
          <p className="muted">Nothing yet. Open the Inbox, pick a thread, and click Generate.</p>
        ) : (
          <ul className="row-list">
            {activity.slice(0, 10).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="row"
                  disabled={!a.threadId}
                  onClick={() => a.threadId && onOpenThread(a.threadId)}
                >
                  <span className={`activity-kind ${a.kind}`}>{a.kind === 'sent' ? 'Sent' : 'Draft'}</span>
                  <span className="row-main">{a.subject || '(no subject)'}</span>
                  <span className="row-meta">{formatDate(a.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="view-actions">
        <button type="button" className="send" onClick={onGoInbox}>Go to Inbox</button>
      </div>
    </div>
  )
}
