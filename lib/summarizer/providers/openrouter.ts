import type { SummarizerProvider, SummarizeRequest } from '../types';
import { openAiCompatibleSummary } from './openaiCompatible';

export class OpenRouterProvider implements SummarizerProvider {
  readonly id = 'openrouter' as const;
  constructor(private readonly apiKey: string) {}

  summarize(request: SummarizeRequest): Promise<string> {
    return openAiCompatibleSummary(
      {
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: this.apiKey,
        providerName: 'OpenRouter',
        extraHeaders: {
          'HTTP-Referer': 'https://github.com/CicerBro',
          'X-OpenRouter-Title': 'Linchpin',
        },
      },
      request,
    );
  }
}
