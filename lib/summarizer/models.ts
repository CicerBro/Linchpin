import { PROVIDER_NAMES, ProviderError, type ProviderId } from './types';
import { providerHttpError } from './httpErrors';

export type ProviderModel = {
  id: string;
  label: string;
};

const MODEL_REQUEST_TIMEOUT_MS = 20_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniqueSorted(models: ProviderModel[]): ProviderModel[] {
  const unique = new Map<string, ProviderModel>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id || id.length > 160 || unique.has(id)) continue;
    unique.set(id, { id, label: model.label.trim().slice(0, 240) || id });
  }
  return [...unique.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

function isOpenAiTextModel(id: string): boolean {
  return ![
    'babbage',
    'computer-use',
    'dall-e',
    'davinci',
    'embedding',
    'gpt-image',
    'moderation',
    'realtime',
    'sora',
    'transcribe',
    'tts',
    'whisper',
  ].some((part) => id.toLowerCase().includes(part));
}

async function requestJson(
  provider: ProviderId,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw await providerHttpError(response, PROVIDER_NAMES[provider], 'model-list request');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) {
      throw new ProviderError(`${PROVIDER_NAMES[provider]} timed out while loading models.`, 'timeout');
    }
    throw new ProviderError(`Could not reach ${PROVIDER_NAMES[provider]} to load models.`, 'network');
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function bearer(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

function openAiCompatibleModels(body: unknown, filterTextModels = false): ProviderModel[] {
  const items = records(record(body)?.data);
  return uniqueSorted(
    items.flatMap((item) => {
      const id = text(item.id);
      return id && (!filterTextModels || isOpenAiTextModel(id)) ? [{ id, label: id }] : [];
    }),
  );
}

export async function fetchProviderModels(
  provider: ProviderId,
  apiKey: string,
): Promise<ProviderModel[]> {
  const key = apiKey.trim();
  if (!key) throw new ProviderError(`Add an API key for ${PROVIDER_NAMES[provider]} in the Linchpin popup.`, 'auth');

  let models: ProviderModel[];
  if (provider === 'openai') {
    const body = await requestJson(provider, 'https://api.openai.com/v1/models', bearer(key));
    models = openAiCompatibleModels(body, true);
  } else if (provider === 'anthropic') {
    const body = await requestJson(provider, 'https://api.anthropic.com/v1/models?limit=1000', {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    models = uniqueSorted(
      records(record(body)?.data).flatMap((item) => {
        const id = text(item.id);
        const displayName = text(item.display_name);
        return id ? [{ id, label: displayName ? `${displayName} — ${id}` : id }] : [];
      }),
    );
  } else if (provider === 'xai') {
    const body = await requestJson(provider, 'https://api.x.ai/v1/language-models', bearer(key));
    models = uniqueSorted(
      records(record(body)?.models).flatMap((item) => {
        const id = text(item.id);
        const aliases = Array.isArray(item.aliases)
          ? item.aliases.map(text).filter((alias): alias is string => Boolean(alias))
          : [];
        return [...(id ? [{ id, label: id }] : []), ...aliases.map((alias) => ({ id: alias, label: alias }))];
      }),
    );
  } else if (provider === 'kimi') {
    const body = await requestJson(provider, 'https://api.moonshot.ai/v1/models', bearer(key));
    models = openAiCompatibleModels(body);
  } else if (provider === 'gemini') {
    const body = await requestJson(
      provider,
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      { 'x-goog-api-key': key },
    );
    models = uniqueSorted(
      records(record(body)?.models).flatMap((item) => {
        const methods = Array.isArray(item.supportedGenerationMethods)
          ? item.supportedGenerationMethods
          : [];
        if (!methods.includes('generateContent')) return [];
        const resourceName = text(item.name);
        const id = resourceName?.replace(/^models\//, '');
        const displayName = text(item.displayName);
        return id ? [{ id, label: displayName ? `${displayName} — ${id}` : id }] : [];
      }),
    );
  } else if (provider === 'glm') {
    const body = await requestJson(
      provider,
      'https://open.bigmodel.cn/api/paas/v4/models',
      bearer(key),
    );
    models = openAiCompatibleModels(body, true);
  } else {
    const body = await requestJson(
      provider,
      'https://openrouter.ai/api/v1/models?output_modalities=text',
      bearer(key),
    );
    models = uniqueSorted(
      records(record(body)?.data).flatMap((item) => {
        const id = text(item.id);
        const name = text(item.name);
        return id ? [{ id, label: name ? `${name} — ${id}` : id }] : [];
      }),
    );
  }

  if (!models.length) {
    throw new ProviderError(`${PROVIDER_NAMES[provider]} returned no compatible text models.`, 'response');
  }
  return models;
}
