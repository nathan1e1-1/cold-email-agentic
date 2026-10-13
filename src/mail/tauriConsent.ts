import { start, cancel, onUrl } from '@fabianlars/tauri-plugin-oauth';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ConsentRunner } from './oauth';

export function createTauriConsentRunner(redirectUri: string): ConsentRunner {
  return async (authUrl: string) => {
    const configuredPort = Number(new URL(redirectUri).port);
    const boundPort = await start(Number.isFinite(configuredPort) && configuredPort > 0
      ? { ports: [configuredPort] }
      : undefined);

    const handle: { unlisten: (() => void) | null } = { unlisten: null };
    try {
      const code = await new Promise<string>((resolve, reject) => {
        onUrl((url) => {
          try {
            const parsed = new URL(url);
            const code = parsed.searchParams.get('code');
            if (code) resolve(code);
            else reject(new Error(parsed.searchParams.get('error') ?? 'OAuth redirect contained no code'));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })
          .then((fn) => {
            handle.unlisten = fn;
          })
          .catch(reject);
        void openUrl(authUrl);
      });
      return { code };
    } finally {
      handle.unlisten?.();
      await cancel(boundPort).catch(() => {});
    }
  };
}
