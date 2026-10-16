import type { Repository } from './repository';
import { TauriRepository } from './tauriRepository';

let cached: Promise<Repository> | null = null;

export function getRepository(): Promise<Repository> {
  if (!cached) cached = TauriRepository.open();
  return cached;
}
