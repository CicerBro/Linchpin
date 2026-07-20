import type { SummarizerProvider, SummarizeRequest } from '../types';
import { openAiCompatibleSummary } from './openaiCompatible';

export class XaiProvider implements SummarizerProvider {
  readonly id = 'xai' as const;
  constructor(private readonly apiKey: string) {}
  summarize(request: SummarizeRequest): Promise<string> {
    return openAiCompatibleSummary(
      {
        endpoint: 'https://api.x.ai/v1/chat/completions',
        apiKey: this.apiKey,
        providerName: 'xAI',
      },
      request,
    );
  }
}
