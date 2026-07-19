import { getTags, mergeTags } from '../storage';
import { storage } from 'wxt/utils/storage';
import { parseResTagsJson } from './resTags';

const seedImportedItem = storage.defineItem<boolean>('local:resSeedImported', {
  fallback: false,
});

export type SeedImportResult =
  | { status: 'skipped'; reason: 'already-imported' | 'tags-present' }
  | { status: 'imported'; added: number; updated: number }
  | { status: 'error'; error: string };

/**
 * One-shot import of bundled RES seed when Rivet has no tags yet.
 * Safe to call from background + popup; never overwrites existing tags.
 */
export async function ensureResSeedImported(): Promise<SeedImportResult> {
  if (await seedImportedItem.getValue()) {
    return { status: 'skipped', reason: 'already-imported' };
  }

  const existing = await getTags();
  if (Object.keys(existing).length > 0) {
    await seedImportedItem.setValue(true);
    return { status: 'skipped', reason: 'tags-present' };
  }

  try {
    const url = browser.runtime.getURL('/data/res-tags-seed.json');
    const res = await fetch(url);
    if (!res.ok) {
      return { status: 'error', error: `Seed fetch failed (${res.status})` };
    }
    const json: unknown = await res.json();
    const tags = parseResTagsJson(json);
    const result = await mergeTags(tags);
    await seedImportedItem.setValue(true);
    console.info('[rivet] RES seed imported', result);
    return {
      status: 'imported',
      added: result.added,
      updated: result.updated,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : 'Seed import failed',
    };
  }
}

/** Allow manual re-import attempts to clear the one-shot latch if desired. */
export async function markResSeedImported(value = true): Promise<void> {
  await seedImportedItem.setValue(value);
}
