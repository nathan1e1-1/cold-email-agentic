import type { HttpClient } from '../mail/httpClient';

interface ModelsResponse {
  models?: { name?: string; supportedGenerationMethods?: string[] }[];
}

export async function listGeminiModels(http: HttpClient, apiKey: string): Promise<string[]> {
  const res = await http.request({
    method: 'GET',
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    headers: { 'x-goog-api-key': apiKey },
  });
  if (res.status >= 400) {
    throw new Error(`Listing Gemini models failed: ${res.status} ${res.body}`);
  }
  let json: ModelsResponse;
  try {
    json = JSON.parse(res.body) as ModelsResponse;
  } catch {
    throw new Error('Listing Gemini models: malformed response');
  }
  return (json.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(Boolean);
}

export function pickGeminiModel(models: string[]): string | null {
  const usable = models.filter(
    (m) => /gemini/i.test(m) && !/embedding|aqa|vision|thinking|tts|image|learnlm/i.test(m),
  );
  const flash = usable.filter((m) => /flash/i.test(m) && !/preview|exp|experimental/i.test(m));
  const pool = flash.length > 0 ? flash : usable;
  if (pool.length === 0) return models[0] ?? null;
  return [...pool].sort().pop() ?? pool[0];
}
