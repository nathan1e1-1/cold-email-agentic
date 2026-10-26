import { describe, it, expect } from 'vitest';
import { mergeThreadPages } from '../../src/services/mailbox';
import type { Thread } from '../../src/domain/types';

const t = (id: string): Thread => ({
  id,
  subject: id,
  participants: [],
  messages: [],
  lastMessageAt: 1,
  snippet: '',
  inInbox: true,
  labels: [],
});

describe('mergeThreadPages', () => {
  it('appends only unseen threads', () => {
    const merged = mergeThreadPages([t('a'), t('b')], [t('b'), t('c')]);
    expect(merged.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});
