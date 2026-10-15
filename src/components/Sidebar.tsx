import type { Account, TonePreset } from '../domain/types'
import { formatDate } from '../lib/format'

export type View = 'dashboard' | 'inbox' | 'settings'

export interface ActivityItem {
  id: number
  kind: 'draft' | 'sent'
  subject: string
  tone: TonePreset
  at: number
  threadId: string | null
}

function NavIcon({ name }: { name: View }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (name === 'dashboard') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    )
  }
  if (name === 'inbox') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M3 12h5l2 3h4l2-3h5" />
        <path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      </svg>
    )
  }
  return (
    <svg {...common} aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2.2" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="15" cy="17" r="2.2" />
    </svg>
  )
}

const NAV: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'settings', label: 'Settings' },
]

interface Props {
  view: View
  onNavigate: (view: View) => void
  account: Account | null
  activity: ActivityItem[]
  onOpenThread: (threadId: string) => void
  busy: string | null
  onConnect: () => void
}

export function Sidebar({ view, onNavigate, account, activity, onOpenThread, busy, onConnect }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">ColdEmailAgentic</div>

      <nav className="nav" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={view === item.id ? 'nav-item active' : 'nav-item'}
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <NavIcon name={item.id} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="activity">
        <div className="activity-head">Activity</div>
        {activity.length === 0 ? (
          <p className="activity-empty">Drafts and sends will show up here.</p>
        ) : (
          <ul>
            {activity.slice(0, 12).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="activity-item"
                  disabled={!a.threadId}
                  onClick={() => a.threadId && onOpenThread(a.threadId)}
                >
                  <span className={`activity-kind ${a.kind}`}>{a.kind === 'sent' ? 'Sent' : 'Draft'}</span>
                  <span className="activity-subject">{a.subject || '(no subject)'}</span>
                  <span className="activity-time">{formatDate(a.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-foot">
        <span className="account-email" title={account?.email ?? 'Not connected'}>
          {account?.email ?? 'Not connected'}
        </span>
        <button type="button" className="chip ghost" disabled={busy !== null} onClick={onConnect}>
          {account ? 'Refresh' : 'Connect'}
        </button>
      </div>
    </aside>
  )
}
