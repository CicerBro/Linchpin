import { getSettings, watchSettings } from '../storage';
import type { JsonItemCountMode } from '../types';

export type JsonTheme = 'system' | 'light' | 'dark';

export type SiteFeatureSettings = {
  jsonFormatter: {
    enabled: boolean;
    darkMode: JsonTheme;
    showArrayIndices: boolean;
    itemCountMode: JsonItemCountMode;
    itemCountThreshold: number;
  };
  google: { mapsButton: boolean; viewImage: boolean };
  youtube: { removeShorts: boolean };
};

const DEFAULTS: SiteFeatureSettings = {
  jsonFormatter: {
    enabled: true,
    darkMode: 'system',
    showArrayIndices: false,
    itemCountMode: 'hide',
    itemCountThreshold: 15,
  },
  google: { mapsButton: true, viewImage: true },
  youtube: { removeShorts: false },
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function thresholdValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(100_000, Math.trunc(value)))
    : fallback;
}

/**
 * Keeps site content scripts decoupled from storage migrations. Nested settings
 * are canonical; flat aliases support development builds created before v2.
 */
export function normalizeSiteFeatureSettings(value: unknown): SiteFeatureSettings {
  const root = record(value);
  const json = record(root.jsonFormatter);
  const google = record(root.google);
  const youtube = record(root.youtube);
  const theme = json.darkMode;

  return {
    jsonFormatter: {
      enabled: booleanValue(json.enabled ?? root.enableJsonFormatter, DEFAULTS.jsonFormatter.enabled),
      darkMode:
        theme === 'light' || theme === 'dark' || theme === 'system'
          ? theme
          : DEFAULTS.jsonFormatter.darkMode,
      showArrayIndices: booleanValue(
        json.showArrayIndices,
        DEFAULTS.jsonFormatter.showArrayIndices,
      ),
      itemCountMode:
        json.itemCountMode === 'show' || json.itemCountMode === 'threshold'
          ? json.itemCountMode
          : DEFAULTS.jsonFormatter.itemCountMode,
      itemCountThreshold: thresholdValue(
        json.itemCountThreshold,
        DEFAULTS.jsonFormatter.itemCountThreshold,
      ),
    },
    google: {
      mapsButton: booleanValue(
        google.mapsButton ?? root.enableGoogleMapsButton,
        DEFAULTS.google.mapsButton,
      ),
      viewImage: booleanValue(
        google.viewImage ?? root.enableGoogleViewImage,
        DEFAULTS.google.viewImage,
      ),
    },
    youtube: {
      removeShorts: booleanValue(
        youtube.removeShorts ?? root.enableYouTubeRemoveShorts,
        DEFAULTS.youtube.removeShorts,
      ),
    },
  };
}

export async function getSiteFeatureSettings(): Promise<SiteFeatureSettings> {
  return normalizeSiteFeatureSettings(await getSettings());
}

export function watchSiteFeatureSettings(
  callback: (settings: SiteFeatureSettings) => void,
): () => void {
  return watchSettings((settings) => callback(normalizeSiteFeatureSettings(settings)));
}
