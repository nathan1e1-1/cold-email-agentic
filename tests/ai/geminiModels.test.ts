import { describe, it, expect } from 'vitest';
import { listGeminiModels, pickGeminiModel } from '../../src/ai/geminiModels';
import { FakeHttpClient } from '../mail/fakeHttp';

describe('geminiModels', () => {
  it('lists only models that support generateContent', async () => {
    const http = new FakeHttpClient().queueResponse({
      status: 200,
      body: JSON.stringify({
        models: [
          { name: 'models/gemini-x-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-y-pro', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    });
    expect(await listGeminiModels(http, 'K')).toEqual(['gemini-x-flash', 'gemini-y-pro']);
    expect(http.requests[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(http.requests[0].headers?.['x-goog-api-key']).toBe('K');
  });

  it('prefers a non-preview flash model', () => {
    expect(pickGeminiModel(['gemini-3-pro', 'gemini-3.8-flash', 'gemini-3-flash-preview'])).toBe('gemini-3.8-flash');
  });

  it('ignores paid/omni/pro models', () => {
    expect(pickGeminiModel(['gemini-omni-1.1-flash', 'gemini-3-pro', 'gemini-3.8-flash'])).toBe('gemini-3.8-flash');
  });

  it('falls back to any usable model', () => {
    expect(pickGeminiModel(['gemini-3-pro'])).toBe('gemini-3-pro');
  });

  it('returns null when there are no models', () => {
    expect(pickGeminiModel([])).toBeNull();
  });
});
