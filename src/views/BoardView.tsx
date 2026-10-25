import { useCallback, useEffect, useState } from 'react'
import {
  DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CARD_STATUSES, type Card, type CardStatus } from '../domain/types'
import type { RepoThread, Repository } from '../db/repository'
import { groupCardsByStatus } from '../services/kanban'
import { loadBoard } from '../services/board'

const COLUMN_LABEL: Record<CardStatus, string> = {
  untouched: "Haven't touched",
  review: 'In review',
  sent: 'Sent',
}

function threadLabel(thread: RepoThread | undefined): string {
  if (!thread) return ''
  const other = thread.participants.find((p) => p.name || p.email)
  return other?.name ?? other?.email ?? ''
}

function CardItem({ card, thread, onOpenThread }: {
  card: Card
  thread: RepoThread | undefined
  onOpenThread: (threadId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  return (
    <article
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'card dragging' : 'card'}
      {...listeners}
      {...attributes}
    >
      <button type="button" className="card-open" onClick={() => thread && onOpenThread(thread.id)}>
        <span className="card-subject">{thread?.subject || '(no subject)'}</span>
        <span className="card-meta">
          {threadLabel(thread)}
          {thread?.lastMessageAt ? ` · ${new Date(thread.lastMessageAt).toLocaleDateString()}` : ''}
        </span>
      </button>
    </article>
  )
}

function Column({ status, cards, threadByRowId, onOpenThread }: {
  status: CardStatus
  cards: Card[]
  threadByRowId: Map<number, RepoThread>
  onOpenThread: (threadId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section ref={setNodeRef} className={isOver ? 'board-col over' : 'board-col'}>
      <header className="board-col-head">
        {COLUMN_LABEL[status]} <span className="count">{cards.length}</span>
      </header>
      <div className="board-col-body">
        {cards.map((card) => (
          <CardItem key={card.id} card={card} thread={threadByRowId.get(card.threadRowId)} onOpenThread={onOpenThread} />
        ))}
        {cards.length === 0 && <p className="board-empty">Drop cards here</p>}
      </div>
    </section>
  )
}

interface Props {
  repo: Repository | null
  onOpenThread: (threadId: string) => void
  refreshKey: number
}

export function BoardView({ repo, onOpenThread, refreshKey }: Props) {
  const [threads, setThreads] = useState<RepoThread[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const load = useCallback(async () => (repo ? loadBoard(repo) : null), [repo])

  const reload = useCallback(async () => {
    const result = await load()
    if (!result) return
    setThreads(result.threads)
    setCards(result.cards)
  }, [load])

  useEffect(() => {
    let active = true
    void load().then((result) => {
      if (!active || !result) return
      setThreads(result.threads)
      setCards(result.cards)
    })
    return () => {
      active = false
    }
  }, [load, refreshKey])

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      if (!repo || !event.over) return
      const cardId = Number(event.active.id)
      const status = event.over.id as CardStatus
      await repo.moveCard(cardId, status, 1_000_000, Date.now())
      await reload()
    },
    [repo, reload],
  )

  const threadByRowId = new Map(threads.map((t) => [t.rowId, t]))
  const grouped = groupCardsByStatus(cards)

  return (
    <div className="board">
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {CARD_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            cards={grouped[status]}
            threadByRowId={threadByRowId}
            onOpenThread={onOpenThread}
          />
        ))}
      </DndContext>
    </div>
  )
}
