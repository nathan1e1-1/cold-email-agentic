import type { HttpClient } from '../mail/httpClient';
import type { AiDescriptor, AiProvider, GenerateRequest } from './aiProvider';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { cleanDraft } from './sanitize';

const HOST = 'api.groq.com';
const MODEL = 'llama-3.3-70b-versatile';
const RETRYABLE_STATUSES = new Set([500, 502, 503]);

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export interface GroqOptions {
  http: HttpClient;
  apiKey: string;
  model?: string;
  maxRetries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class GroqProvider implements AiProvider {
  descriptor: AiDescriptor = {
    id: 'groq',
    label: 'Groq',
    privacy: 'may-use-content',
    host: HOST,
  };

  private http: HttpClient;
  private apiKey: string;
  private model: string;
  private maxRetries: number;
  private backoffMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(deps: GroqOptions) {
    this.http = deps.http;
    this.apiKey = deps.apiKey;
    this.model = deps.model ?? MODEL;
    this.maxRetries = deps.maxRetries ?? 3;
    this.backoffMs = deps.backoffMs ?? 1000;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.7,
    });
    const url = `https://${HOST}/openai/v1/chat/completions`;

    for (let attempt = 0; ; attempt++) {
      const res = await this.http.request({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body,
      });
      if (RETRYABLE_STATUSES.has(res.status) && attempt < this.maxRetries) {
        await this.sleep(this.backoffMs * 2 ** attempt);
        continue;
      }
      return this.parseResponse(res);
    }
  }

  private parseResponse(res: { status: number; body: string }): string {
    if (res.status >= 400) {
      throw new Error(`Groq request failed: ${res.status} ${res.body}`);
    }
    let json: GroqResponse;
    try {
      json = JSON.parse(res.body) as GroqResponse;
    } catch {
      throw new Error('Groq: malformed response');
    }
    if (json.error) throw new Error(json.error.message ?? 'Groq error');
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error('Groq returned an empty draft');
    return cleanDraft(text);
  }
}
