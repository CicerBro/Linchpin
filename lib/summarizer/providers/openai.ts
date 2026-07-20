import type { SummarizerProvider, SummarizeRequest } from '../types';
import { openAiCompatibleSummary } from './openaiCompatible';

export class OpenAiProvider implements SummarizerProvider {
  readonly id = 'openai' as const;
  constructor(private readonly apiKey: string) {}
  summarize(request: SummarizeRequest): Promise<string> {
    return openAiCompatibleSummary(
      {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: this.apiKey,
        providerName: 'OpenAI',
      },
      request,
    );
  }
}
