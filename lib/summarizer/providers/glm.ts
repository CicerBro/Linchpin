import type { SummarizerProvider, SummarizeRequest } from '../types';
import { openAiCompatibleSummary } from './openaiCompatible';

export class GlmProvider implements SummarizerProvider {
  readonly id = 'glm' as const;
  constructor(private readonly apiKey: string) {}
  summarize(request: SummarizeRequest): Promise<string> {
    return openAiCompatibleSummary(
      {
        endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        apiKey: this.apiKey,
        providerName: 'GLM',
      },
      request,
    );
  }
}
