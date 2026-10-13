import type { Repository } from '../db/repository';
import type { SendKind } from '../domain/types';
import type { SettingsService } from '../services/settings';

export type GuardReason =
  | 'missing_mailing_address'
  | 'do_not_contact'
  | 'rate_limit_day'
  | 'rate_limit_minute';

export type GuardResult = { ok: true } | { ok: false; reason: GuardReason };

export interface GuardInput {
  kind: SendKind;
  toEmail: string;
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export async function sendGuard(
  repo: Repository,
  settings: SettingsService,
  input: GuardInput,
): Promise<GuardResult> {
  if (input.kind === 'cold') {
    const mailingAddress = (await settings.get('mailing_address')).trim();
    if (mailingAddress === '') return { ok: false, reason: 'missing_mailing_address' };
  }

  const contact = await repo.getContactByEmail(input.toEmail);
  if (contact?.doNotContact) return { ok: false, reason: 'do_not_contact' };

  if (input.kind === 'cold') {
    const perDay = await settings.getInt('rate_limit_per_day');
    const perMinute = await settings.getInt('rate_limit_per_minute');
    if ((await repo.countSendsSince(input.now - DAY_MS, 'cold')) >= perDay) {
      return { ok: false, reason: 'rate_limit_day' };
    }
    if ((await repo.countSendsSince(input.now - MINUTE_MS, 'cold')) >= perMinute) {
      return { ok: false, reason: 'rate_limit_minute' };
    }
  }

  return { ok: true };
}

export async function duplicateWarning(repo: Repository, toEmail: string): Promise<boolean> {
  return repo.hasColdSendTo(toEmail);
}
