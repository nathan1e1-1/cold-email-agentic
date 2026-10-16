import type { PrivacyClass, Thread, TonePreset } from '../domain/types';

export interface AiDescriptor {
  id: string;
  label: string;
  privacy: PrivacyClass;
  host: string;
}

export interface ContactContext {
  name?: string;
  email: string;
  notes?: string;
}

export interface GenerateRequest {
  thread?: Thread;
  contact?: ContactContext;
  mode?: 'reply' | 'cold';
  ownEmail: string;
  tone: TonePreset;
  instruction?: string;
  priorDraft?: string;
  signature?: string;
}

export interface AiProvider {
  descriptor: AiDescriptor;
  generate(req: GenerateRequest): Promise<string>;
}
