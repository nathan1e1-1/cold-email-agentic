import type { HttpClient, HttpRequest, HttpResponse } from '../../src/mail/httpClient';

export class FakeHttpClient implements HttpClient {
  requests: HttpRequest[] = [];
  private queue: HttpResponse[] = [];
  private handler?: (req: HttpRequest) => HttpResponse;

  queueResponse(res: HttpResponse): this {
    this.queue.push(res);
    return this;
  }

  onRequest(handler: (req: HttpRequest) => HttpResponse): this {
    this.handler = handler;
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    if (this.handler) return this.handler(req);
    const next = this.queue.shift();
    if (!next) throw new Error(`FakeHttpClient: no queued response for ${req.method} ${req.url}`);
    return next;
  }
}
