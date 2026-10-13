import type { SecretStore } from '../mail/oauth';
import { deleteSecret, getSecret, setSecret } from './secrets';

export const keychainSecretStore: SecretStore = {
  get: (key) => getSecret(key),
  set: (key, value) => setSecret(key, value),
  delete: (key) => deleteSecret(key),
};
