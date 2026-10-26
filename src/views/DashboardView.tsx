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

function iconProps() {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

function InboxIcon() {
  return (
    <svg {...iconProps()} aria-hidden="true">
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    </svg>
  )
}

function PenIcon() {
  return (
    <svg {...iconProps()} aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg {...iconProps()} aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22 11 13 2 9 22 2z" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg {...iconProps()} aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg {...iconProps()} aria-hidden="true">
      <polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2" />
    </svg>
  )
}

function activityLabel(item: ActivityItem): string {
  if (item.kind === 'sent') return 'Sent reply'
  return item.tone ? `Drafted · ${item.tone}` : 'Drafted reply'
}

export function DashboardView({
  account, threadCount, draftsThisSession, sentThisSession, activity, aiLabel, aiPrivacy, onOpenThread, onGoInbox,
}: Props) {
  const privacyText = aiLabel
    ? aiPrivacy === 'local'
      ? 'Running a local model — thread content stays on this Mac.'
      : aiPrivacy === 'may-use-content'
        ? 'Your provider may process thread content to write drafts.'
        : 'Drafts are written with your configured AI provider.'
    : 'Add an AI key in Settings to start drafting replies.'

  return (
    <div className="view dashboard-view">
      <header className="page-head">
        <div className="page-head-main">
          <h1 className="view-title">Outreach overview</h1>
          <p className="view-sub">
            {account ? `Connected as ${account.email}` : 'Connect a mail account to load your inbox.'}
          </p>
        </div>
        <span className={aiLabel ? 'pill info' : 'pill'}>
          {aiLabel ? 'AI ready' : 'AI not configured'}
        </span>
      </header>

      <section className="stats" aria-label="Session summary">
        <article className="stat">
          <span className="stat-icon"><InboxIcon /></span>
          <span className="stat-label">Threads loaded</span>
          <span className="stat-num">{threadCount}</span>
          <span className="stat-sub">Outreach conversations synced</span>
        </article>
        <article className="stat">
          <span className="stat-icon"><PenIcon /></span>
          <span className="stat-label">Drafts this session</span>
          <span className="stat-num">{draftsThisSession}</span>
          <span className="stat-sub">Generated in this session</span>
        </article>
        <article className="stat">
          <span className="stat-icon"><SendIcon /></span>
          <span className="stat-label">Sent this session</span>
          <span className="stat-num">{sentThisSession}</span>
          <span className="stat-sub">Replies sent from your mailbox</span>
        </article>
        <article className="stat">
          <span className="stat-icon"><SparkIcon /></span>
          <span className="stat-label">AI provider</span>
          <span className="stat-num stat-num-sm">{aiLabel ?? '—'}</span>
          <span className="stat-sub">
            {aiPrivacy ? (aiPrivacy === 'local' ? 'Local model' : 'May use content') : 'Not configured'}
          </span>
        </article>
      </section>

      <div className="dash">
        <div className="dash-main">
          <div className="card stream-card">
            <div className="card-head">
              <div className="card-head-main">
                <span className="card-title">Recent activity</span>
                <span className="card-sub">Drafts and sends from this session</span>
              </div>
              <span className="pill">{activity.length} event{activity.length === 1 ? '' : 's'}</span>
            </div>
            {activity.length === 0 ? (
              <p className="muted">Nothing yet. Open the Inbox, pick a thread, and click Generate.</p>
            ) : (
              <ul className="row-list">
                {activity.slice(0, 10).map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="row stream-row"
                      disabled={!a.threadId}
                      onClick={() => a.threadId && onOpenThread(a.threadId)}
                    >
                      <span className={`stream-icon ${a.kind}`} aria-hidden="true">
                        {a.kind === 'sent' ? <SendIcon /> : <PenIcon />}
                      </span>
                      <span className="stream-main">
                        <span className="stream-subject">{a.subject || '(no subject)'}</span>
                        <span className="stream-meta">{activityLabel(a)} · {formatDate(a.at)}</span>
                      </span>
                      <span className={`activity-kind ${a.kind}`}>{a.kind === 'sent' ? 'Sent' : 'Draft'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="dash-rail">
          <div className="card ai-card">
            <div className="ai-card-head">
              <span className="ai-glyph" aria-hidden="true"><SparkIcon /></span>
              <span className="ai-badge">{aiLabel ?? 'Not configured'}</span>
            </div>
            <h2 className="rail-title">AI drafter</h2>
            <p className="rail-text">{privacyText}</p>
            <button type="button" className="btn btn-on-primary" onClick={onGoInbox}>
              Open Inbox
            </button>
          </div>

          <div className="card rail-card">
            <div className="card-head">
              <div className="card-head-main">
                <span className="card-title">Quick actions</span>
                <span className="card-sub">Keep the session moving</span>
              </div>
            </div>
            <p className="rail-text">
              Pick a thread in the Inbox, then generate a reply. Drafts stay editable until you send them.
            </p>
            <div className="rail-actions">
              <button type="button" className="btn btn-secondary" onClick={onGoInbox}>
                Go to Inbox
              </button>
            </div>
            <div className="rail-note">
              <span className="rail-note-icon" aria-hidden="true"><BoltIcon /></span>
              <span>Test mode is available in the top bar for safe dry runs.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
