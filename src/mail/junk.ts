import type { Thread } from '../domain/types';

const NO_REPLY_LOCALPART =
  /(^|[._+-])(no-?reply|donotreply|do-not-reply|notifications?|mailer-daemon|bounce|automated|alerts?)([._+-]|$)/i;

const JUNK_LABELS = new Set([
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
]);

export function isJunkThread(thread: Thread): boolean {
  if (thread.labels.some((label) => JUNK_LABELS.has(label))) return true;
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === 'inbound');
  if (!lastInbound) return false;
  if (lastInbound.hasListUnsubscribe) return true;
  const localPart = lastInbound.from.email.split('@')[0] ?? '';
  return NO_REPLY_LOCALPART.test(localPart);
}
