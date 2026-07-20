import { ProviderError, type SummarizerProvider, type SummarizeRequest } from '../types';

export class GeminiProvider implements SummarizerProvider {
  readonly id = 'gemini' as const;
  constructor(private readonly apiKey: string) {}

  async summarize(request: SummarizeRequest): Promise<string> {
    if (!this.apiKey.trim()) throw new ProviderError('Add an API key for Gemini.', 'auth');
    const model = encodeURIComponent(request.model);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), 60_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: request.content }] }],
          generationConfig: { temperature: request.temperature },
        }),
      });
      if (response.status === 401 || response.status === 403) throw new ProviderError('Gemini rejected the API key.', 'auth', response.status);
      if (response.status === 429) throw new ProviderError('Gemini rate limit or quota was reached.', 'rate-limit', 429);
      if (!response.ok) throw new ProviderError(`Gemini request failed (HTTP ${response.status}).`, 'response', response.status);
      const body: unknown = await response.json();
      const parts = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }).candidates?.[0]?.content?.parts;
      const text = parts?.filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n');
      if (!text?.trim()) throw new ProviderError('Gemini returned a malformed response.', 'response');
      return text.trim();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (request.signal.aborted) throw new ProviderError('Summary request cancelled.', 'cancelled');
      if (controller.signal.aborted) throw new ProviderError('Summary request timed out.', 'timeout');
      throw new ProviderError('Could not reach Gemini.', 'network');
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  }
}
