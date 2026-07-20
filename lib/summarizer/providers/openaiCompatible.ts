import { ProviderError, type SummarizeRequest } from '../types';
import { providerHttpError } from '../httpErrors';

const REQUEST_TIMEOUT_MS = 60_000;

type OpenAiCompatibleOptions = {
  endpoint: string;
  apiKey: string;
  providerName: string;
  extraHeaders?: Record<string, string>;
};

function assertHttps(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new ProviderError('Provider endpoint must use HTTPS.', 'network');
  return parsed;
}

function requestSignal(parent: AbortSignal): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  );
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) abort();
  return {
    signal: controller.signal,
    cleanup() {
      globalThis.clearTimeout(timeout);
      parent.removeEventListener('abort', abort);
    },
  };
}

export async function openAiCompatibleSummary(
  options: OpenAiCompatibleOptions,
  request: SummarizeRequest,
): Promise<string> {
  if (!options.apiKey.trim()) throw new ProviderError(`Add an API key for ${options.providerName}.`, 'auth');
  const endpoint = assertHttps(options.endpoint);
  const scoped = requestSignal(request.signal);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: scoped.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
        ...options.extraHeaders,
      },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        temperature: request.temperature,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.content },
        ],
      }),
    });
    if (!response.ok) throw await providerHttpError(response, options.providerName);
    const body: unknown = await response.json();
    const text = (body as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new ProviderError(`${options.providerName} returned a malformed response.`, 'response');
    }
    return text.trim();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (request.signal.aborted) throw new ProviderError('Summary request cancelled.', 'cancelled');
    if (scoped.signal.aborted) throw new ProviderError('Summary request timed out.', 'timeout');
    throw new ProviderError(`Could not reach ${options.providerName}.`, 'network');
  } finally {
    scoped.cleanup();
  }
}
