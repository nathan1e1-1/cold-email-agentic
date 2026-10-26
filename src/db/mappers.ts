import type { Address, Card, Contact, Draft, Message } from '../domain/types';
import type { RepoAccount, RepoThread } from './repository';

export const bool = (n: number | null | undefined) => n === 1;
export const toBool = (b: boolean) => (b ? 1 : 0);
export const j = (v: unknown) => JSON.stringify(v ?? null);
export const pj = <T,>(s: string | null, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback);
export const normEmail = (email: string) => email.trim().toLowerCase();

export function mapAccount(r: any): RepoAccount {
  return { rowId: r.id, provider: r.provider, email: r.email, ownEmail: r.own_email,
    displayName: r.display_name ?? undefined, tokenRef: r.token_ref,
    createdAt: r.created_at };
}

export function mapThread(r: any): RepoThread {
  return { rowId: r.id, accountId: r.account_id, id: r.provider_thread_id, subject: r.subject,
    participants: pj<Address[]>(r.participants_json, []), labels: pj<string[]>(r.labels_json, []),
    messages: [], lastMessageAt: r.last_message_at, snippet: r.snippet, inInbox: bool(r.in_inbox) };
}

export function mapMessage(r: any): Message {
  return { id: r.provider_message_id, rfcMessageId: r.rfc_message_id,
    references: pj<string[]>(r.references_json, []), from: pj<Address>(r.from_json, { email: '' }),
    to: pj<Address[]>(r.to_json, []), cc: pj<Address[]>(r.cc_json, []), subject: r.subject,
    bodyText: r.body_text, bodyHtml: r.body_html ?? undefined,
    hasListUnsubscribe: bool(r.has_list_unsubscribe), date: r.date, direction: r.direction };
}

export function mapCard(r: any): Card {
  return { id: r.id, threadRowId: r.thread_id, status: r.status, position: r.position, updatedAt: r.updated_at };
}

export function mapContact(r: any): Contact {
  return { id: r.id, name: r.name, email: r.email, notes: r.notes, doNotContact: bool(r.do_not_contact) };
}

export function mapDraft(r: any): Draft {
  return { id: r.id, cardId: r.card_id, contactId: r.contact_id, body: r.body, model: r.model,
    tone: r.tone, instruction: r.instruction, isChosen: bool(r.is_chosen), createdAt: r.created_at };
}
