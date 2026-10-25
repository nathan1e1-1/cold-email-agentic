import type { Account, TonePreset } from '../domain/types'
import { formatDate } from '../lib/format'

export type View = 'inbox' | 'board' | 'dashboard' | 'trash' | 'settings'

export interface ActivityItem {
  id: number
  kind: 'draft' | 'sent'
  subject: string
  tone?: TonePreset
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
  if (name === 'board') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="4" width="5" height="16" rx="1.5" />
        <rect x="9.5" y="4" width="5" height="10" rx="1.5" />
        <rect x="16" y="4" width="5" height="13" rx="1.5" />
      </svg>
    )
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
  if (name === 'trash') {
    return (
      <svg {...common} aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
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

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {collapsed ? <polyline points="9 6 15 12 9 18" /> : <polyline points="15 6 9 12 15 18" />}
    </svg>
  )
}

const NAV: { id: View; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'board', label: 'Board' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'trash', label: 'Trash' },
]

interface Props {
  view: View
  onNavigate: (view: View) => void
  account: Account | null
  activity: ActivityItem[]
  onOpenThread: (threadId: string) => void
  busy: string | null
  onConnect: () => void
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({
  view, onNavigate, account, activity, onOpenThread, busy, onConnect, collapsed, onToggle,
}: Props) {
  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sidebar-head">
        {!collapsed && <div className="sidebar-brand">ColdEmailAgentic</div>}
        <button
          type="button"
          className="collapse-btn"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Chevron collapsed={collapsed} />
        </button>
      </div>

      <nav className="nav" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={view === item.id ? 'nav-item active' : 'nav-item'}
            aria-current={view === item.id ? 'page' : undefined}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <NavIcon name={item.id} />
            {!collapsed && item.label}
          </button>
        ))}
      </nav>

      {!collapsed && (
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
      )}

      <div className="sidebar-settings">
        <button
          type="button"
          className={view === 'settings' ? 'nav-item active' : 'nav-item'}
          aria-current={view === 'settings' ? 'page' : undefined}
          aria-label="Settings"
          title={collapsed ? 'Settings' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <NavIcon name="settings" />
          {!collapsed && 'Settings'}
        </button>
      </div>

      {!collapsed && (
        <div className="sidebar-foot">
          <span className="account-email" title={account?.email ?? 'Not connected'}>
            {account?.email ?? 'Not connected'}
          </span>
          <button type="button" className="chip ghost" disabled={busy !== null} onClick={onConnect}>
            {account ? 'Refresh' : 'Connect'}
          </button>
        </div>
      )}
    </aside>
  )
}
