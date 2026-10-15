import type { HttpClient } from '../mail/httpClient';
import type { AiDescriptor, AiProvider, GenerateRequest } from './aiProvider';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { cleanDraft } from './sanitize';
import { MAX_RETRY_WAIT_MS, parseRetryDelayMs } from './retry';

const HOST = 'generativelanguage.googleapis.com';
const MODEL = 'gemini-3.8-flash';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export interface GeminiOptions {
  http: HttpClient;
  apiKey: string;
  model?: string;
  maxRetries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class GeminiProvider implements AiProvider {
  descriptor: AiDescriptor = {
    id: 'gemini',
    label: 'Gemini',
    privacy: 'may-use-content',
    host: HOST,
  };

  private http: HttpClient;
  private apiKey: string;
  private model: string;
  private maxRetries: number;
  private backoffMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(deps: GeminiOptions) {
    this.http = deps.http;
    this.apiKey = deps.apiKey;
    this.model = deps.model ?? MODEL;
    this.maxRetries = deps.maxRetries ?? 3;
    this.backoffMs = deps.backoffMs ?? 1000;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // Returns how long to wait before retrying, or null to stop and surface the response.
  // 429 (rate limit) is retryable when the server's hint is short (per-minute limits);
  // a huge hint (daily/quota exhausted) fails fast so the caller can fall back.
  private retryDelay(res: { status: number; body: string }, attempt: number): number | null {
    if (res.status === 429) {
      const hinted = parseRetryDelayMs(res.body);
      if (hinted !== null) return hinted <= MAX_RETRY_WAIT_MS ? hinted : null;
      return Math.min(this.backoffMs * 2 ** attempt, MAX_RETRY_WAIT_MS);
    }
    if (res.status === 500 || res.status === 502 || res.status === 503) {
      return Math.min(this.backoffMs * 2 ** attempt, MAX_RETRY_WAIT_MS);
    }
    return null;
  }

  async generate(req: GenerateRequest): Promise<string> {
    const system = buildSystemPrompt({ tone: req.tone, signature: req.signature });
    const user = buildUserPrompt({
      thread: req.thread,
      tone: req.tone,
      instruction: req.instruction,
      priorDraft: req.priorDraft,
    });
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.7 },
    });
    const url = `https://${HOST}/v1beta/models/${this.model}:generateContent`;

    for (let attempt = 0; ; attempt++) {
      const res = await this.http.request({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body,
      });
      const delay = attempt < this.maxRetries ? this.retryDelay(res, attempt) : null;
      if (delay !== null) {
        await this.sleep(delay);
        continue;
      }
      return this.parseResponse(res);
    }
  }

  private parseResponse(res: { status: number; body: string }): string {
    if (res.status >= 400) {
      throw new Error(`Gemini request failed: ${res.status} ${res.body}`);
    }
    let json: GeminiResponse;
    try {
      json = JSON.parse(res.body) as GeminiResponse;
    } catch {
      throw new Error('Gemini: malformed response');
    }
    if (json.error) throw new Error(json.error.message ?? 'Gemini error');
    if (json.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) throw new Error('Gemini returned an empty draft');
    return cleanDraft(text);
  }
}
