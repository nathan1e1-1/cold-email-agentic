import http from 'node:http';
import { execFile } from 'node:child_process';
import { createPkce, buildAuthUrl, exchangeCode, type Authenticator } from '../src/mail/oauth';
import type { HttpClient } from '../src/mail/httpClient';
import { GmailProvider } from '../src/mail/gmailProvider';
import { GeminiProvider } from '../src/ai/geminiProvider';
import { GroqProvider } from '../src/ai/groqProvider';
import { listGeminiModels, pickGeminiModel } from '../src/ai/geminiModels';
import type { AiProvider, GenerateRequest } from '../src/ai/aiProvider';
import type { TonePreset } from '../src/domain/types';

const nodeHttp: HttpClient = {
  async request(req) {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    return { status: res.status, body: await res.text() };
  },
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

async function obtainAccessToken(clientId: string, clientSecret: string | undefined, port: number): Promise<string> {
  const redirectUri = `http://127.0.0.1:${port}`;
  const { verifier, challenge } = await createPkce();
  const authUrl = buildAuthUrl({ clientId, redirectUri, challenge });

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', redirectUri);
      const received = parsed.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('You can close this tab and return to the terminal.');
      server.close();
      if (received) resolve(received);
      else reject(new Error(parsed.searchParams.get('error') ?? 'OAuth redirect contained no code'));
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      console.log(`Opening the browser for Google consent (redirect ${redirectUri})…`);
      execFile('open', [authUrl]);
    });
  });

  const tokens = await exchangeCode({ code, verifier, redirectUri, clientId, clientSecret }, nodeHttp);
  return tokens.accessToken;
}

async function buildAiProviders(): Promise<AiProvider[]> {
  const providers: AiProvider[] = [];

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    let model = process.env.GEMINI_MODEL;
    if (!model) {
      try {
        const models = await listGeminiModels(nodeHttp, geminiKey);
        model = pickGeminiModel(models) ?? undefined;
        if (model) console.log(`Gemini model selected from the live list: ${model}`);
      } catch (err) {
        console.warn(`Could not list Gemini models: ${err instanceof Error ? err.message : err}`);
      }
    }
    providers.push(new GeminiProvider({ http: nodeHttp, apiKey: geminiKey, model }));
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    providers.push(new GroqProvider({ http: nodeHttp, apiKey: groqKey, model: process.env.GROQ_MODEL }));
  }

  if (providers.length === 0) throw new Error('Set GEMINI_API_KEY and/or GROQ_API_KEY');

  const preferred = process.env.AI_PROVIDER;
  if (preferred) {
    providers.sort((a, b) => (a.descriptor.id === preferred ? -1 : 0) - (b.descriptor.id === preferred ? -1 : 0));
  }
  return providers;
}

async function generateWithFallback(
  providers: AiProvider[],
  req: GenerateRequest,
): Promise<{ text: string; label: string }> {
  let lastError: unknown;
  for (const provider of providers) {
    try {
      return { text: await provider.generate(req), label: provider.descriptor.label };
    } catch (err) {
      lastError = err;
      console.warn(`  ${provider.descriptor.label} failed: ${err instanceof Error ? err.message : err} — trying next`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function main(): Promise<void> {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const port = Number(process.env.OAUTH_PORT ?? 8765);
  const limit = Number(process.env.GMAIL_LIMIT ?? 3);
  const tone = (process.env.TONE ?? 'professional') as TonePreset;

  const providers = await buildAiProviders();
  console.log(`AI providers (in order): ${providers.map((p) => p.descriptor.label).join(' -> ')}\n`);

  const accessToken = await obtainAccessToken(clientId, clientSecret, port);
  const auth: Authenticator = {
    auth: async () => {},
    isAuthed: async () => true,
    getAccessToken: async () => accessToken,
  };

  const bootstrap = new GmailProvider({ http: nodeHttp, auth, ownEmail: '' });
  const { emailAddress: ownEmail } = await bootstrap.getProfile();
  console.log(`Connected as ${ownEmail}\n`);

  const gmail = new GmailProvider({ http: nodeHttp, auth, ownEmail });
  const { threads } = await gmail.listThreads({ sinceDays: 90, cap: limit });
  console.log(`Fetched ${threads.length} thread(s) — tone "${tone}"\n`);

  for (const thread of threads.slice(0, limit)) {
    const { text, label } = await generateWithFallback(providers, { thread, ownEmail, tone });
    const last = thread.messages[thread.messages.length - 1];
    console.log('='.repeat(72));
    console.log(`THREAD: ${thread.subject}  (${thread.messages.length} message(s))`);
    console.log(`LAST FROM: ${last?.from.email ?? ''}`);
    console.log(`DRAFT (${label}):`);
    console.log('-'.repeat(72));
    console.log(text);
    console.log();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
