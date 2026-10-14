export function cleanDraft(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\r?\n?/i, '')
    .replace(/\r?\n?```$/i, '')
    .replace(/\s*\\$/, '')
    .trim();
}
