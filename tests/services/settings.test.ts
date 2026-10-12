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
});
