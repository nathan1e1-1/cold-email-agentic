import type { HttpClient } from './httpClient';
import type { Authenticator } from './oauth';
import type { GraphMessage } from './outlookParse';

const BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_ORIGIN = 'https://graph.microsoft.com/';
const PREFER = 'IdType="ImmutableId", outlook.body-content-type="text"';
const LIST_SELECT =
  'id,conversationId,internetMessageId,subject,bodyPreview,from,toRecipients,ccRecipients,' +
  'receivedDateTime,sentDateTime,parentFolderId,internetMessageHeaders,isDraft';
const FULL_SELECT =
  'id,conversationId,internetMessageId,subject,body,from,toRecipients,ccRecipients,' +
  'receivedDateTime,sentDateTime,parentFolderId,internetMessageHeaders,isDraft';

export interface GraphMessagePage { messages: GraphMessage[]; nextLink: string | null }
export interface GraphProfile { emailAddress: string; displayName?: string }

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function ensureOk(res: { status: number; body: string }, label: string): void {
  if (res.status >= 200 && res.status < 300) return;
  let message = res.body;
  let code: string | undefined;
  try {
    const json = JSON.parse(res.body) as { error?: { code?: string; message?: string } };
    message = json.error?.message ?? res.body;
    code = json.error?.code;
  } catch {
    /* keep the raw body */
  }
  throw new Error(
    `${label}: HTTP ${res.status}${code ? ` ${code}` : ''}: ${message.slice(0, 400)}`,
  );
}

function graphNextLink(link: string): string {
  if (!link.startsWith(GRAPH_ORIGIN)) {
    throw new Error('Microsoft Graph: refusing non-Graph nextLink');
  }
  return link;
}

export class MicrosoftGraphProvider {
  private http: HttpClient;
  private authenticator: Authenticator;

  constructor(deps: { http: HttpClient; auth: Authenticator }) {
    this.http = deps.http;
    this.authenticator = deps.auth;
  }

  auth(): Promise<void> {
    return this.authenticator.auth();
  }

  isAuthed(): Promise<boolean> {
    return this.authenticator.isAuthed();
  }

  private async request(method: string, url: string, body?: string) {
    const token = await this.authenticator.getAccessToken();
    return this.http.request({
      method,
      url: url.startsWith('http') ? url : `${BASE}${url}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: PREFER,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
  }

  async getFolderId(name: 'inbox' | 'deleteditems' | 'junkemail' | 'sentitems'): Promise<string> {
    const res = await this.request('GET', `/me/mailFolders/${name}?$select=id`);
    ensureOk(res, `Microsoft Graph folder ${name}`);
    let json: { id?: string };
    try {
      json = JSON.parse(res.body) as { id?: string };
    } catch {
      throw new Error(`Microsoft Graph: malformed folder response for ${name}`);
    }
    if (!json.id) throw new Error(`Microsoft Graph: folder ${name} has no id`);
    return json.id;
  }

  async getProfile(): Promise<GraphProfile> {
    const query = new URLSearchParams({ $select: 'mail,userPrincipalName,displayName' });
    const res = await this.request('GET', `/me?${query.toString()}`);
    ensureOk(res, 'Microsoft Graph getProfile');
    const json = JSON.parse(res.body) as {
      mail?: string; userPrincipalName?: string; displayName?: string;
    };
    const emailAddress = json.mail || json.userPrincipalName || '';
    if (!emailAddress) throw new Error('Microsoft Graph: profile has no email');
    return {
      emailAddress,
      ...(json.displayName ? { displayName: json.displayName } : {}),
    };
  }

  async listMessages(opts: {
    folder?: 'inbox' | 'deleteditems' | 'all';
    top?: number;
    filter?: string;
    nextLink?: string;
  }): Promise<GraphMessagePage> {
    let url: string;
    if (opts.nextLink) {
      url = graphNextLink(opts.nextLink);
    } else {
      const query = new URLSearchParams({
        $top: String(opts.top ?? 20),
        $select: LIST_SELECT,
      });
      if (opts.filter) query.set('$filter', opts.filter);
      const path = opts.folder === 'all'
        ? '/me/messages'
        : `/me/mailFolders/${opts.folder ?? 'inbox'}/messages`;
      url = `${path}?${query.toString()}`;
    }
    const res = await this.request('GET', url);
    ensureOk(res, 'Microsoft Graph listMessages');
    const json = JSON.parse(res.body) as {
      value?: GraphMessage[]; '@odata.nextLink'?: string;
    };
    const next = json['@odata.nextLink'];
    return {
      messages: json.value ?? [],
      nextLink: next ? graphNextLink(next) : null,
    };
  }

  async getMessage(id: string): Promise<GraphMessage> {
    const query = new URLSearchParams({ $select: FULL_SELECT });
    const res = await this.request(
      'GET',
      `/me/messages/${encodeURIComponent(id)}?${query.toString()}`,
    );
    ensureOk(res, `Microsoft Graph getMessage ${id}`);
    const message = JSON.parse(res.body) as GraphMessage | null;
    if (!message?.id) throw new Error(`Microsoft Graph getMessage ${id}: empty response`);
    return message;
  }

  async listConversation(conversationId: string, maxMessages = 50): Promise<GraphMessage[]> {
    const top = Math.min(maxMessages, 100);
    let url: string | null = `/me/messages?${new URLSearchParams({
      $filter: `conversationId eq '${escapeODataString(conversationId)}'`,
      $top: String(top),
      $select: FULL_SELECT,
    }).toString()}`;
    const messages: GraphMessage[] = [];
    for (let page = 0; page < 5 && url; page++) {
      const res = await this.request('GET', url);
      ensureOk(res, 'Microsoft Graph listConversation');
      const json = JSON.parse(res.body) as {
        value?: GraphMessage[]; '@odata.nextLink'?: string;
      };
      messages.push(...(json.value ?? []));
      if (messages.length >= maxMessages) break;
      const next = json['@odata.nextLink'];
      url = next ? graphNextLink(next) : null;
    }
    return messages.slice(0, maxMessages);
  }

  async sendMail(input: {
    to: string[];
    subject: string;
    bodyText: string;
  }): Promise<void> {
    const res = await this.request(
      'POST',
      '/me/sendMail',
      JSON.stringify({
        message: {
          subject: input.subject,
          body: { contentType: 'Text', content: input.bodyText },
          toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    );
    ensureOk(res, 'Microsoft Graph sendMail');
  }

  async reply(messageId: string, comment: string): Promise<void> {
    const res = await this.request(
      'POST',
      `/me/messages/${encodeURIComponent(messageId)}/reply`,
      JSON.stringify({ comment }),
    );
    ensureOk(res, 'Microsoft Graph reply');
  }

  async move(messageId: string, destinationId: 'inbox' | 'deleteditems'): Promise<void> {
    const res = await this.request(
      'POST',
      `/me/messages/${encodeURIComponent(messageId)}/move`,
      JSON.stringify({ destinationId }),
    );
    ensureOk(res, 'Microsoft Graph move');
  }
}
