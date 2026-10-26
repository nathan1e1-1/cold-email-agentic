type Listener = (message: string) => void
const listeners = new Set<Listener>()

export function onGlobalError(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function emitGlobalError(message: string): void {
  for (const fn of listeners) fn(message)
}

export function installGlobalHandlers(): () => void {
  const onError = (event: ErrorEvent) => emitGlobalError(event.message || String(event.error))
  const onRejection = (event: PromiseRejectionEvent) =>
    emitGlobalError(String(event.reason?.message ?? event.reason))
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
