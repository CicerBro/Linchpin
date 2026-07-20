import type { ProviderId } from './types';
import { PROVIDER_IDS } from './types';
import { getSettings } from '../storage';
import type { SummaryStyle } from './prompts';

const PREFERENCES_KEY = 'linchpin:summarizer-preferences';
const API_KEYS_KEY = 'linchpin:summarizer-api-keys';

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: 'gpt-5-mini',
  anthropic: 'claude-3-5-haiku-latest',
  xai: 'grok-4.3',
  kimi: 'moonshot-v1-8k',
  gemini: 'gemini-3.5-flash',
  glm: 'glm-4.5-flash',
  openrouter: 'openrouter/auto',
};

export const PROVIDER_ORIGINS: Record<ProviderId, string> = {
  openai: 'https://api.openai.com/*',
  anthropic: 'https://api.anthropic.com/*',
  xai: 'https://api.x.ai/*',
  kimi: 'https://api.moonshot.ai/*',
  gemini: 'https://generativelanguage.googleapis.com/*',
  glm: 'https://open.bigmodel.cn/*',
  openrouter: 'https://openrouter.ai/*',
};

export type SummarizerConfig = {
  provider: ProviderId;
  models: Record<SummaryStyle, string>;
  /** Legacy/default alias retained for settings exports and upgrades. */
  model: string;
  apiKeys: Partial<Record<ProviderId, string>>;
};

export const DEFAULT_SUMMARIZER_CONFIG: SummarizerConfig = {
  provider: 'openai',
  models: {
    brief: DEFAULT_MODELS.openai,
    bullets: DEFAULT_MODELS.openai,
    detailed: DEFAULT_MODELS.openai,
  },
  model: DEFAULT_MODELS.openai,
  apiKeys: {},
};

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId);
}

export async function getSummarizerConfig(): Promise<SummarizerConfig> {
  const stored = await browser.storage.local.get([PREFERENCES_KEY, API_KEYS_KEY]);
  const rawPreferences = stored[PREFERENCES_KEY];
  const rawKeys = stored[API_KEYS_KEY];
  const record =
    rawPreferences && typeof rawPreferences === 'object' && !Array.isArray(rawPreferences)
      ? (rawPreferences as Record<string, unknown>)
      : {};
  const exportedPreferences = !rawPreferences ? (await getSettings()).summarizer : undefined;
  const provider = isProviderId(record.provider)
    ? record.provider
    : isProviderId(exportedPreferences?.provider)
      ? exportedPreferences.provider
      : 'openai';
  const model =
    typeof record.model === 'string' && record.model.trim().length <= 160
      ? record.model.trim()
      : typeof exportedPreferences?.model === 'string' && exportedPreferences.model.trim().length <= 160
        ? exportedPreferences.model.trim() || DEFAULT_MODELS[provider]
      : DEFAULT_MODELS[provider];
  const storedModels = record.models && typeof record.models === 'object' && !Array.isArray(record.models)
    ? (record.models as Record<string, unknown>)
    : {};
  const models: Record<SummaryStyle, string> = {
    brief: typeof storedModels.brief === 'string' && storedModels.brief.trim().length <= 160
      ? storedModels.brief.trim()
      : model,
    bullets: typeof storedModels.bullets === 'string' && storedModels.bullets.trim().length <= 160
      ? storedModels.bullets.trim()
      : model,
    detailed: typeof storedModels.detailed === 'string' && storedModels.detailed.trim().length <= 160
      ? storedModels.detailed.trim()
      : model,
  };
  const apiKeys: Partial<Record<ProviderId, string>> = {};
  if (rawKeys && typeof rawKeys === 'object' && !Array.isArray(rawKeys)) {
    for (const id of PROVIDER_IDS) {
      const value = (rawKeys as Record<string, unknown>)[id];
      if (typeof value === 'string' && value.length <= 1000) apiKeys[id] = value;
    }
  }
  return { provider, model: models.brief, models, apiKeys };
}

export async function saveSummarizerDefaults(
  provider: ProviderId,
  models: Record<SummaryStyle, string>,
): Promise<void> {
  const normalized: Record<SummaryStyle, string> = {
    brief: models.brief.trim().slice(0, 160),
    bullets: models.bullets.trim().slice(0, 160),
    detailed: models.detailed.trim().slice(0, 160),
  };
  await browser.storage.local.set({
    [PREFERENCES_KEY]: { provider, model: normalized.brief, models: normalized },
  });
}

export async function saveProviderApiKey(
  provider: ProviderId,
  apiKey: string,
): Promise<void> {
  const current = await getSummarizerConfig();
  const nextKeys = { ...current.apiKeys };
  const trimmed = apiKey.trim();
  if (trimmed) nextKeys[provider] = trimmed.slice(0, 1000);
  else delete nextKeys[provider];
  await browser.storage.local.set({
    [API_KEYS_KEY]: nextKeys,
  });
}

export async function requestProviderPermission(provider: ProviderId): Promise<boolean> {
  if (!browser.permissions?.request) return true;
  try {
    return await browser.permissions.request({ origins: [PROVIDER_ORIGINS[provider]] });
  } catch {
    return false;
  }
}

/** Safe for backups/preferences export: API keys are deliberately omitted. */
export function publicSummarizerPreferences(config: SummarizerConfig): {
  provider: ProviderId;
  model: string;
  models: Record<SummaryStyle, string>;
} {
  return { provider: config.provider, model: config.model, models: config.models };
}
