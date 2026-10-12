import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import { SettingsService } from '../../src/services/settings';

describe('SettingsService', () => {
  it('returns documented defaults when unset', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    expect(await s.get('rate_limit_per_day')).toBe('25');
    expect(await s.get('rate_limit_per_minute')).toBe('3');
    expect(await s.get('ai_provider')).toBe('gemini');
    expect(await s.get('signature')).toBe('');
    expect(await s.get('mailing_address')).toBe('');
  });

  it('persists overrides over defaults', async () => {
    const repo = new NodeRepository(':memory:');
    const s = new SettingsService(repo);
    await s.set('mailing_address', '1 Main St');
    expect(await s.get('mailing_address')).toBe('1 Main St');
    const s2 = new SettingsService(repo);
    expect(await s2.get('mailing_address')).toBe('1 Main St');
  });

  it('returns numeric defaults via getInt', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    expect(await s.getInt('rate_limit_per_day')).toBe(25);
    expect(await s.getInt('rate_limit_per_minute')).toBe(3);
  });

  it('throws when a numeric setting is not numeric', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    await s.set('rate_limit_per_day', 'abc');
    await expect(s.getInt('rate_limit_per_day')).rejects.toThrow(/not numeric/);
  });

  it('overwrites an existing setting', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    await s.set('signature', 'A');
    await s.set('signature', 'B');
    expect(await s.get('signature')).toBe('B');
  });

  it('defaults unsubscribe_mailto to own_email when unset', async () => {
    const repo = new NodeRepository(':memory:');
    const s = new SettingsService(repo);
    await s.set('own_email', 'me@x.com');
    expect(await s.get('unsubscribe_mailto')).toBe('me@x.com');
    await s.set('unsubscribe_mailto', 'unsub@x.com');
    expect(await s.get('unsubscribe_mailto')).toBe('unsub@x.com');
  });

  it('rejects unknown setting keys at compile time', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    // @ts-expect-error unknown key must not be allowed
    await expect(s.get('not_a_key')).resolves.toBeUndefined();
  });
});
