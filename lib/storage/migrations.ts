import {
  DEFAULT_SETTINGS,
  type FeatureSettings,
  type LegacySettings,
  type SettingsPatch,
} from '../types';
import {
  schemaVersionItem,
  settingsItem,
  STORAGE_SCHEMA_VERSION,
} from './schema';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function string(value: unknown, fallback: string, max = 200): string {
  return typeof value === 'string' && value.length <= max ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.trunc(value)))
    : fallback;
}

/** Normalize both the legacy flat object and partially-written future objects. */
export function normalizeSettings(raw: unknown): FeatureSettings {
  const root = object(raw);
  const reddit = object(root.reddit);
  const jsonFormatter = object(root.jsonFormatter);
  const google = object(root.google);
  const youtube = object(root.youtube);
  const summarizer = object(root.summarizer);
  const legacy = root as LegacySettings;

  return {
    reddit: {
      tags: bool(reddit.tags, bool(legacy.enableTags, DEFAULT_SETTINGS.reddit.tags)),
      ignore: bool(reddit.ignore, bool(legacy.enableIgnore, DEFAULT_SETTINGS.reddit.ignore)),
      accountSwitcher: bool(reddit.accountSwitcher, DEFAULT_SETTINGS.reddit.accountSwitcher),
      infiniteScroll: bool(
        reddit.infiniteScroll,
        bool(legacy.enableOldRedditInfiniteScroll, DEFAULT_SETTINGS.reddit.infiniteScroll),
      ),
      subredditVisits: bool(
        reddit.subredditVisits,
        bool(legacy.enableSubredditLastVisited, DEFAULT_SETTINGS.reddit.subredditVisits),
      ),
      newCommentCounts: bool(
        reddit.newCommentCounts,
        bool(legacy.enableNewCommentCounts, DEFAULT_SETTINGS.reddit.newCommentCounts),
      ),
      tagBadgeStyle:
        reddit.tagBadgeStyle === 'text' || reddit.tagBadgeStyle === 'pill'
          ? reddit.tagBadgeStyle
          : legacy.tagBadgeStyle === 'text' || legacy.tagBadgeStyle === 'pill'
            ? legacy.tagBadgeStyle
            : DEFAULT_SETTINGS.reddit.tagBadgeStyle,
    },
    jsonFormatter: {
      enabled: bool(jsonFormatter.enabled, DEFAULT_SETTINGS.jsonFormatter.enabled),
      darkMode:
        jsonFormatter.darkMode === 'light' || jsonFormatter.darkMode === 'dark'
          ? jsonFormatter.darkMode
          : 'system',
      showArrayIndices: bool(
        jsonFormatter.showArrayIndices,
        DEFAULT_SETTINGS.jsonFormatter.showArrayIndices,
      ),
      itemCountMode:
        jsonFormatter.itemCountMode === 'show' || jsonFormatter.itemCountMode === 'threshold'
          ? jsonFormatter.itemCountMode
          : 'hide',
      itemCountThreshold: integer(
        jsonFormatter.itemCountThreshold,
        DEFAULT_SETTINGS.jsonFormatter.itemCountThreshold,
        1,
        100_000,
      ),
    },
    google: {
      mapsButton: bool(google.mapsButton, DEFAULT_SETTINGS.google.mapsButton),
      viewImage: bool(google.viewImage, DEFAULT_SETTINGS.google.viewImage),
    },
    youtube: {
      removeShorts: bool(youtube.removeShorts, DEFAULT_SETTINGS.youtube.removeShorts),
    },
    summarizer: {
      enabled: bool(summarizer.enabled, DEFAULT_SETTINGS.summarizer.enabled),
      provider: string(summarizer.provider, DEFAULT_SETTINGS.summarizer.provider, 40),
      model: string(summarizer.model, DEFAULT_SETTINGS.summarizer.model, 120),
    },
  };
}

export function mergeSettings(current: FeatureSettings, patch: SettingsPatch): FeatureSettings {
  return normalizeSettings({
    ...current,
    ...patch,
    reddit: { ...current.reddit, ...patch.reddit },
    jsonFormatter: { ...current.jsonFormatter, ...patch.jsonFormatter },
    google: { ...current.google, ...patch.google },
    youtube: { ...current.youtube, ...patch.youtube },
    summarizer: { ...current.summarizer, ...patch.summarizer },
  });
}

export async function migrateSettings(): Promise<FeatureSettings> {
  const raw = await settingsItem.getValue();
  const next = normalizeSettings(raw);
  const version = await schemaVersionItem.getValue();
  if (version < STORAGE_SCHEMA_VERSION || JSON.stringify(raw) !== JSON.stringify(next)) {
    await settingsItem.setValue(next);
    await schemaVersionItem.setValue(STORAGE_SCHEMA_VERSION);
  }
  return next;
}
