import type { Address, Direction, Message, Thread } from '../domain/types';

export interface GraphEmailAddress { name?: string; address: string }
export interface GraphRecipient { emailAddress: GraphEmailAddress }
export interface GraphHeader { name: string; value: string }
export interface GraphMessage {
  id: string;
  conversationId?: string | null;
  internetMessageId?: string | null;
  subject?: string | null;
  bodyPreview?: string;
  body?: { contentType?: 'text' | 'html'; content?: string } | null;
  from?: { emailAddress?: GraphEmailAddress } | null;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  parentFolderId?: string;
  internetMessageHeaders?: GraphHeader[];
  isDraft?: boolean;
}

function headerValue(headers: GraphHeader[], name: string): string {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

function toAddress(address: GraphEmailAddress | undefined | null): Address {
  const email = address?.address ?? '';
  const name = address?.name?.trim();
  return name ? { name, email } : { email };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripHtml(html: string): string {
  const withBreaks = html
    .replace(/\r\n?/g, '\n')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)\s*>/gi, '\n');
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseDate(m: GraphMessage): number {
  const received = Date.parse(m.receivedDateTime ?? '');
  if (Number.isFinite(received)) return received;
  const sent = Date.parse(m.sentDateTime ?? '');
  return Number.isFinite(sent) ? sent : 0;
}

function bodyTextOf(m: GraphMessage): string {
  const content = m.body?.content;
  if (content) return m.body?.contentType === 'html' ? stripHtml(content) : content;
  return m.bodyPreview ?? '';
}

export function parseOutlookMessage(m: GraphMessage, ownEmail: string): Message {
  const headers = m.internetMessageHeaders ?? [];
  const from = toAddress(m.from?.emailAddress);
  const direction: Direction =
    from.email.toLowerCase() === ownEmail.trim().toLowerCase() ? 'outbound' : 'inbound';
  const listUnsubscribe = headerValue(headers, 'List-Unsubscribe').trim();
  return {
    id: m.id,
    rfcMessageId: m.internetMessageId ?? '',
    references: headerValue(headers, 'References').match(/<[^>]+>/g) ?? [],
    from,
    to: (m.toRecipients ?? []).map((r) => toAddress(r.emailAddress)),
    cc: (m.ccRecipients ?? []).map((r) => toAddress(r.emailAddress)),
    subject: m.subject ?? '',
    bodyText: bodyTextOf(m),
    hasListUnsubscribe: listUnsubscribe !== '' && listUnsubscribe !== '<>',
    date: parseDate(m),
    direction,
  };
}

export function groupOutlookThreads(
  messages: GraphMessage[],
  ownEmail: string,
  opts: { inInbox?: boolean } = {},
): Thread[] {
  const groups = new Map<string, GraphMessage[]>();
  for (const m of messages) {
    if (m.isDraft) continue;
    const key = m.conversationId || m.id;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }

  const threads: Thread[] = [];
  for (const [key, group] of groups) {
    const parsed = group
      .map((m) => parseOutlookMessage(m, ownEmail))
      .sort((a, b) => a.date - b.date);

    const participants: Address[] = [];
    const seen = new Set<string>();
    for (const msg of parsed) {
      for (const a of [msg.from, ...msg.to, ...msg.cc]) {
        const emailKey = a.email.toLowerCase();
        if (a.email && !seen.has(emailKey)) {
          seen.add(emailKey);
          participants.push(a);
        }
      }
    }

    const last = parsed[parsed.length - 1];
    const subject = parsed.find((m) => m.subject !== '')?.subject ?? '';
    threads.push({
      id: key,
      subject,
      participants,
      messages: parsed,
      lastMessageAt: parsed.length > 0 ? Math.max(...parsed.map((m) => m.date)) : 0,
      snippet: (last?.bodyText ?? '').slice(0, 160),
      inInbox: opts.inInbox ?? true,
      labels: [],
    });
  }

  return threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}
