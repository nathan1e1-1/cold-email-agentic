import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { HttpClient, HttpRequest, HttpResponse } from './httpClient';

export class TauriHttpClient implements HttpClient {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const res = await tauriFetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return { status: res.status, body: await res.text() };
  }
}
