export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'xai',
  'kimi',
  'gemini',
  'glm',
  'openrouter',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI',
  kimi: 'Kimi',
  gemini: 'Gemini',
  glm: 'GLM',
  openrouter: 'OpenRouter',
};

export type SummarizeRequest = {
  model: string;
  systemPrompt: string;
  temperature: number;
  content: string;
  signal: AbortSignal;
};

export interface SummarizerProvider {
  readonly id: ProviderId;
  summarize(request: SummarizeRequest): Promise<string>;
}

export type ExtractedPage = {
  title: string;
  url: string;
  site: string;
  byline?: string;
  language?: string;
  excerpt?: string;
  content: string;
  originalLength: number;
  truncated: boolean;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      'auth' | 'rate-limit' | 'quota' | 'timeout' | 'cancelled' | 'network' | 'response',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
