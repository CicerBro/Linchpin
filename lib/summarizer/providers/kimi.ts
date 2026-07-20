import type { SummarizerProvider, SummarizeRequest } from '../types';
import { openAiCompatibleSummary } from './openaiCompatible';

export class KimiProvider implements SummarizerProvider {
  readonly id = 'kimi' as const;
  constructor(private readonly apiKey: string) {}
  summarize(request: SummarizeRequest): Promise<string> {
    return openAiCompatibleSummary(
      {
        endpoint: 'https://api.moonshot.ai/v1/chat/completions',
        apiKey: this.apiKey,
        providerName: 'Kimi',
      },
      request,
    );
  }
}
