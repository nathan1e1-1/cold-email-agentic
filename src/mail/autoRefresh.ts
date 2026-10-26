export const AUTO_REFRESH_MS = 60_000;
export const AUTO_REFRESH_TICK_MS = 15_000;

/**
 * Whether a silent inbox refresh should run now.
 * - only while the document is visible (no polling when backgrounded),
 * - never while another refresh is in flight,
 * - at most once per `intervalMs`.
 */
export type VisibilityState = 'visible' | 'hidden' | 'prerender' | 'unknown';

export function shouldAutoRefresh(
  visibility: VisibilityState,
  lastRefreshAt: number,
  now: number,
  inFlight: boolean,
  intervalMs: number = AUTO_REFRESH_MS,
): boolean {
  if (inFlight) return false;
  if (visibility !== 'visible') return false;
  return now - lastRefreshAt >= intervalMs;
}
