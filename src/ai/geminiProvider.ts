import type { HttpClient } from '../mail/httpClient';
import type { AiDescriptor, AiProvider, GenerateRequest } from './aiProvider';
import { buildSystemPrompt, buildUserPrompt } from './prompt';

const HOST = 'generativelanguage.googleapis.com';
const MODEL = 'gemini-3.8-flash';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
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

  constructor(deps: { http: HttpClient; apiKey: string; model?: string }) {
    this.http = deps.http;
    this.apiKey = deps.apiKey;
    this.model = deps.model ?? MODEL;
  }

  async generate(req: GenerateRequest): Promise<string> {
    const system = buildSystemPrompt({ tone: req.tone, signature: req.signature });
    const user = buildUserPrompt({
      thread: req.thread,
      tone: req.tone,
      instruction: req.instruction,
      priorDraft: req.priorDraft,
    });

    const res = await this.http.request({
      method: 'POST',
      url: `https://${HOST}/v1beta/models/${this.model}:generateContent`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7 },
      }),
    });

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
    return text.trim();
  }
}
