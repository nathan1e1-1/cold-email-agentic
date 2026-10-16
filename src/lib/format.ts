export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function initials(input: string): string {
  const base = input.includes('@') ? input.split('@')[0] : input
  const parts = base.split(/[\s._-]+/).filter(Boolean)
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : base.slice(0, 2)
  return letters.toUpperCase()
}
