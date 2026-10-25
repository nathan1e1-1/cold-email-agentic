export const CARD_STATUSES = ['untouched', 'review', 'sent'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const TONE_PRESETS = ['professional', 'friendly', 'concise', 'direct', 'match'] as const;
export type TonePreset = (typeof TONE_PRESETS)[number];

export type Direction = 'inbound' | 'outbound';
export type SendKind = 'reply' | 'cold';
export type PrivacyClass = 'may-use-content' | 'local';

export interface Address { name?: string; email: string }

export interface Message {
  id: string;
  rfcMessageId: string;
  references: string[];
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  hasListUnsubscribe: boolean;
  date: number;
  direction: Direction;
}

export interface Thread {
  id: string;
  subject: string;
  participants: Address[];
  messages: Message[];
  lastMessageAt: number;
  snippet: string;
  inInbox: boolean;
  labels: string[];
  historyId?: string | null;
}

export interface Account {
  provider: 'gmail' | 'outlook';
  email: string;
  ownEmail: string;
  displayName?: string;
}

export interface Contact {
  id: number;
  name: string;
  email: string;
  notes?: string;
  doNotContact: boolean;
}

export interface Card {
  id: number;
  threadRowId: number;
  status: CardStatus;
  position: number;
  updatedAt: number;
}

export interface ColdRecipient {
  email: string;
  lastSentAt: number;
}

export interface Draft {
  id: number;
  cardId: number | null;
  contactId: number | null;
  body: string;
  model: string;
  tone: TonePreset;
  instruction: string;
  isChosen: boolean;
  createdAt: number;
}
