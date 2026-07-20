import type { ProviderId, SummarizerProvider } from '../types';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { GlmProvider } from './glm';
import { KimiProvider } from './kimi';
import { OpenAiProvider } from './openai';
import { OpenRouterProvider } from './openrouter';
import { XaiProvider } from './xai';

export function createProvider(id: ProviderId, apiKey: string): SummarizerProvider {
  switch (id) {
    case 'openai':
      return new OpenAiProvider(apiKey);
    case 'anthropic':
      return new AnthropicProvider(apiKey);
    case 'xai':
      return new XaiProvider(apiKey);
    case 'kimi':
      return new KimiProvider(apiKey);
    case 'gemini':
      return new GeminiProvider(apiKey);
    case 'glm':
      return new GlmProvider(apiKey);
    case 'openrouter':
      return new OpenRouterProvider(apiKey);
  }
}
