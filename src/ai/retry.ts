export const MAX_RETRY_WAIT_MS = 60_000;

// Gemini returns `"retryDelay": "26s"` inside 429 bodies.
export function parseRetryDelayMs(body: string): number | null {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}
