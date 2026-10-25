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
  });

  it('persists overrides over defaults', async () => {
    const repo = new NodeRepository(':memory:');
    const s = new SettingsService(repo);
    await s.set('own_email', 'me@x.com');
    expect(await s.get('own_email')).toBe('me@x.com');
    const s2 = new SettingsService(repo);
    expect(await s2.get('own_email')).toBe('me@x.com');
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

  it('throws when a numeric setting is empty', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    await s.set('rate_limit_per_day', '');
    await expect(s.getInt('rate_limit_per_day')).rejects.toThrow(/not numeric/);
  });

  it('overwrites an existing setting', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    await s.set('signature', 'A');
    await s.set('signature', 'B');
    expect(await s.get('signature')).toBe('B');
  });

  it('rejects unknown setting keys at compile time', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    // @ts-expect-error unknown key must not be allowed
    await expect(s.get('not_a_key')).resolves.toBeUndefined();
  });
});
