import { ProviderError, type SummarizerProvider, type SummarizeRequest } from '../types';

export class AnthropicProvider implements SummarizerProvider {
  readonly id = 'anthropic' as const;
  constructor(private readonly apiKey: string) {}

  async summarize(request: SummarizeRequest): Promise<string> {
    if (!this.apiKey.trim()) throw new ProviderError('Add an API key for Anthropic.', 'auth');
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
      60_000,
    );
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: 2048,
          temperature: request.temperature,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.content }],
        }),
      });
      if (response.status === 401 || response.status === 403)
        throw new ProviderError('Anthropic rejected the API key.', 'auth', response.status);
      if (response.status === 429)
        throw new ProviderError(
          'Anthropic rate limit was reached. Try again later.',
          'rate-limit',
          429,
        );
      if (!response.ok)
        throw new ProviderError(
          `Anthropic request failed (HTTP ${response.status}).`,
          'response',
          response.status,
        );
      const body: unknown = await response.json();
      const blocks = (body as { content?: Array<{ type?: string; text?: unknown }> }).content;
      const text = blocks
        ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n');
      if (!text?.trim())
        throw new ProviderError('Anthropic returned a malformed response.', 'response');
      return text.trim();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (request.signal.aborted)
        throw new ProviderError('Summary request cancelled.', 'cancelled');
      if (controller.signal.aborted)
        throw new ProviderError('Summary request timed out.', 'timeout');
      throw new ProviderError('Could not reach Anthropic.', 'network');
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  }
}
