import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import { SettingsService } from '../../src/services/settings';
import { sendGuard, duplicateWarning } from '../../src/mail/sendGuard';

function ctx() {
  const repo = new NodeRepository(':memory:');
  const settings = new SettingsService(repo);
  return { repo, settings };
}

describe('sendGuard', () => {
  it('blocks do_not_contact addresses for any kind', async () => {
    const { repo, settings } = ctx();
    await repo.upsertContact({ name: 'A', email: 'a@z.com', notes: '', doNotContact: false });
    await repo.setDoNotContact('a@z.com', true);
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'A@Z.com', now: 1000 }))
      .toEqual({ ok: false, reason: 'do_not_contact' });
    expect(await sendGuard(repo, settings, { kind: 'reply', toEmail: 'a@z.com', now: 1000 }))
      .toEqual({ ok: false, reason: 'do_not_contact' });
  });

  it('enforces the per-day cold limit', async () => {
    const { repo, settings } = ctx();
    await settings.set('rate_limit_per_day', '2');
    const now = 10 * 24 * 60 * 60 * 1000;
    await repo.recordSend(now - 1000, 'cold', 'x@z.com');
    await repo.recordSend(now - 2000, 'cold', 'y@z.com');
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'z@z.com', now }))
      .toEqual({ ok: false, reason: 'rate_limit_day' });
  });

  it('enforces the per-minute cold limit', async () => {
    const { repo, settings } = ctx();
    await settings.set('rate_limit_per_day', '100');
    await settings.set('rate_limit_per_minute', '1');
    const now = 10 * 24 * 60 * 60 * 1000;
    await repo.recordSend(now - 1000, 'cold', 'x@z.com');
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'z@z.com', now }))
      .toEqual({ ok: false, reason: 'rate_limit_minute' });
  });

  it('warns on duplicate cold sends', async () => {
    const { repo } = ctx();
    await repo.recordSend(1, 'cold', 'x@z.com');
    expect(await duplicateWarning(repo, 'X@Z.com')).toBe(true);
    expect(await duplicateWarning(repo, 'new@z.com')).toBe(false);
  });

  it('allows a cold send exactly one under the limit', async () => {
    const { repo, settings } = ctx();
    await settings.set('rate_limit_per_day', '2');
    const now = 10 * 24 * 60 * 60 * 1000;
    await repo.recordSend(now - 1000, 'cold', 'x@z.com');
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'z@z.com', now })).toEqual({ ok: true });
  });

  it('does not rate-limit replies even when the cold window is full', async () => {
    const { repo, settings } = ctx();
    await settings.set('rate_limit_per_day', '1');
    await settings.set('rate_limit_per_minute', '1');
    const now = 10 * 24 * 60 * 60 * 1000;
    await repo.recordSend(now - 1000, 'cold', 'x@z.com');
    expect(await sendGuard(repo, settings, { kind: 'reply', toEmail: 'z@z.com', now })).toEqual({ ok: true });
  });

  it('counts sends at the inclusive window edge', async () => {
    const { repo, settings } = ctx();
    await settings.set('rate_limit_per_day', '1');
    const now = 10 * 24 * 60 * 60 * 1000;
    await repo.recordSend(now - 24 * 60 * 60 * 1000, 'cold', 'x@z.com');
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'z@z.com', now }))
      .toEqual({ ok: false, reason: 'rate_limit_day' });
  });

  it('falls back to defaults when a rate setting is not numeric', async () => {
    const { repo, settings } = ctx();
    await settings.set('rate_limit_per_day', 'garbage');
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'z@z.com', now: 1000 })).toEqual({ ok: true });
  });
});
