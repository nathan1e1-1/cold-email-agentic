import type { Repository } from '../db/repository';
import type { SendKind } from '../domain/types';
import { SETTING_DEFAULTS, type SettingKey, type SettingsService } from '../services/settings';

export type GuardReason =
  | 'do_not_contact'
  | 'rate_limit_day'
  | 'rate_limit_minute';

export type GuardResult = { ok: true } | { ok: false; reason: GuardReason };

export interface GuardInput {
  kind: SendKind;
  toEmail: string;
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

async function readLimit(settings: SettingsService, key: SettingKey): Promise<number> {
  try {
    return await settings.getInt(key);
  } catch {
    return Number(SETTING_DEFAULTS[key]);
  }
}

export async function sendGuard(
  repo: Repository,
  settings: SettingsService,
  input: GuardInput,
): Promise<GuardResult> {
  const now = input.now ?? Date.now();

  const contact = await repo.getContactByEmail(input.toEmail);
  if (contact?.doNotContact) return { ok: false, reason: 'do_not_contact' };

  if (input.kind === 'cold') {
    const perDay = await readLimit(settings, 'rate_limit_per_day');
    const perMinute = await readLimit(settings, 'rate_limit_per_minute');
    if ((await repo.countSendsSince(now - DAY_MS, 'cold')) >= perDay) {
      return { ok: false, reason: 'rate_limit_day' };
    }
    if ((await repo.countSendsSince(now - MINUTE_MS, 'cold')) >= perMinute) {
      return { ok: false, reason: 'rate_limit_minute' };
    }
  }

  return { ok: true };
}

export async function duplicateWarning(repo: Repository, toEmail: string): Promise<boolean> {
  return repo.hasColdSendTo(toEmail);
}
