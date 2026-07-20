#!/usr/bin/env node
/**
 * Chromium-only developer tool: export RES user tags from LevelDB into JSON
 * for Linchpin's bundled seed / manual import.
 *
 * Reads Chrome/Brave/Edge/etc. profile storage on disk (Node CLI — not the
 * extension). Firefox is not supported (IndexedDB/SQLite backend).
 *
 * Usage:
 *   node scripts/export-res-tags.mjs
 *   node scripts/export-res-tags.mjs --browser chrome
 *   node scripts/export-res-tags.mjs --path "/path/to/Local Extension Settings/<id>"
 *   node scripts/export-res-tags.mjs --list
 *   node scripts/export-res-tags.mjs --out data/res-tags-seed.json --labeled-only
 *
 * Does NOT export accountSwitcher passwords or other RESoptions.
 */

import { ClassicLevel } from 'classic-level';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** Chrome Web Store id for Reddit Enhancement Suite */
const RES_EXT_ID = 'kbmfpngjjgdllneeigpgjifpgocmfgmb';

/**
 * Relative profile roots under the OS application-support / config dir.
 * Values are path segments joined onto the platform base.
 */
const BROWSERS = {
  brave: {
    label: 'Brave',
    darwin: ['BraveSoftware', 'Brave-Browser'],
    linux: ['BraveSoftware', 'Brave-Browser'],
    win32: ['BraveSoftware', 'Brave-Browser'],
  },
  chrome: {
    label: 'Chrome',
    darwin: ['Google', 'Chrome'],
    linux: ['google-chrome'],
    win32: ['Google', 'Chrome'],
  },
  chromium: {
    label: 'Chromium',
    darwin: ['Chromium'],
    linux: ['chromium'],
    win32: ['Chromium'],
  },
  edge: {
    label: 'Edge',
    darwin: ['Microsoft Edge'],
    linux: ['microsoft-edge'],
    win32: ['Microsoft', 'Edge'],
  },
  arc: {
    label: 'Arc',
    darwin: ['Arc'],
    linux: null,
    win32: ['Arc', 'User Data'],
  },
  vivaldi: {
    label: 'Vivaldi',
    darwin: ['Vivaldi'],
    linux: ['vivaldi'],
    win32: ['Vivaldi'],
  },
  opera: {
    label: 'Opera',
    darwin: ['com.operasoftware.Opera'],
    linux: ['opera'],
    win32: ['Opera Software', 'Opera Stable'],
  },
};

const BROWSER_PREF_ORDER = [
  'brave',
  'chrome',
  'chromium',
  'edge',
  'arc',
  'vivaldi',
  'opera',
];

function parseArgs(argv) {
  const args = {
    out: path.join(root, 'data/res-tags-seed.json'),
    profile: 'Default',
    browser: null,
    path: null,
    labeledOnly: false,
    list: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--labeled-only') args.labeledOnly = true;
    else if (a === '--list') args.list = true;
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '--browser') args.browser = String(argv[++i] || '').toLowerCase();
    else if (a === '--path') args.path = path.resolve(argv[++i]);
  }
  return args;
}

function platformKey() {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win32';
  return 'linux';
}

function userDataBase() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support');
    case 'win32':
      return process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    default:
      return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  }
}

function browserUserDataDir(browserId) {
  const spec = BROWSERS[browserId];
  if (!spec) return null;
  const segments = spec[platformKey()];
  if (!segments) return null;
  return path.join(userDataBase(), ...segments);
}

function resStorageDir(browserId, profile) {
  const userData = browserUserDataDir(browserId);
  if (!userData) return null;
  return path.join(userData, profile, 'Local Extension Settings', RES_EXT_ID);
}

function findResInstalls(profile) {
  const found = [];
  for (const id of BROWSER_PREF_ORDER) {
    const dir = resStorageDir(id, profile);
    if (dir && fs.existsSync(dir)) {
      found.push({
        browser: id,
        label: BROWSERS[id].label,
        profile,
        path: dir,
      });
    }
  }
  return found;
}

function printHelp() {
  const names = BROWSER_PREF_ORDER.join(', ');
  console.log(`Export RES tags from Chromium LevelDB → JSON (Chrome/Brave/Edge/…)

Chromium browsers only. Firefox RES storage is not readable this way.

Options:
  --browser <name>     ${names}
  --path <dir>         Direct path to RES "Local Extension Settings/<id>"
  --profile <name>     Browser profile folder (default: Default)
  --out <path>         Output file (default: data/res-tags-seed.json)
  --labeled-only       Only tags with text/color/ignore/link
  --list               Show RES LevelDB installs for --profile
  -h, --help           Show this help

With no --browser or --path, the first install found in preference order is used.
`);
}

function hasLabelFields(value) {
  return Boolean(
    value.text ||
      value.color ||
      value.ignore ||
      value.link ||
      (typeof value.text === 'string' && value.text.length),
  );
}

async function loadClassicLevel() {
  let ClassicLevelCtor = ClassicLevel;
  try {
    if (!ClassicLevelCtor) {
      ({ ClassicLevel: ClassicLevelCtor } = await import('classic-level'));
    }
  } catch {
    console.error('Missing dependency: classic-level. Run: npm i -D classic-level');
    process.exit(1);
  }
  return ClassicLevelCtor;
}

async function exportTags(src, { labeledOnly }) {
  const ClassicLevelCtor = await loadClassicLevel();
  const copy = path.join(os.tmpdir(), `linchpin-leveldb-${Date.now()}`);
  fs.cpSync(src, copy, { recursive: true });

  const db = new ClassicLevelCtor(copy, {
    createIfMissing: false,
    keyEncoding: 'utf8',
    valueEncoding: 'utf8',
  });
  await db.open();

  const tags = {};
  let total = 0;
  let kept = 0;

  try {
    for await (const [key, raw] of db.iterator()) {
      if (!key.startsWith('tag.')) continue;
      total++;
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        continue;
      }
      if (labeledOnly && !hasLabelFields(value)) continue;
      const username = key.slice(4).toLowerCase();
      tags[username] = value;
      kept++;
    }
  } finally {
    await db.close();
    fs.rmSync(copy, { recursive: true, force: true });
  }

  return { tags, total, kept };
}

function resolveSource(args) {
  if (args.path) {
    if (!fs.existsSync(args.path)) {
      console.error(`RES storage not found at:\n  ${args.path}`);
      process.exit(1);
    }
    return {
      browser: 'custom',
      label: 'custom path',
      profile: args.profile,
      path: args.path,
    };
  }

  if (args.browser) {
    if (!BROWSERS[args.browser]) {
      console.error(
        `Unknown browser "${args.browser}". Use one of: ${BROWSER_PREF_ORDER.join(', ')}`,
      );
      process.exit(1);
    }
    if (!browserUserDataDir(args.browser)) {
      console.error(
        `${BROWSERS[args.browser].label} is not supported on ${process.platform}.`,
      );
      process.exit(1);
    }
    const dir = resStorageDir(args.browser, args.profile);
    if (!fs.existsSync(dir)) {
      console.error(`RES storage not found at:\n  ${dir}`);
      console.error(
        `Is ${BROWSERS[args.browser].label} installed with RES (id ${RES_EXT_ID})?`,
      );
      console.error('Tip: run with --list to see detected installs.');
      process.exit(1);
    }
    return {
      browser: args.browser,
      label: BROWSERS[args.browser].label,
      profile: args.profile,
      path: dir,
    };
  }

  const found = findResInstalls(args.profile);
  if (found.length === 0) {
    console.error(
      `No RES LevelDB found for profile "${args.profile}" under known Chromium browsers.`,
    );
    console.error(`Looked for extension id ${RES_EXT_ID}.`);
    console.error('Tip: pass --browser, --path, or --list.');
    process.exit(1);
  }
  if (found.length > 1) {
    console.log(
      `Found ${found.length} RES installs; using ${found[0].label} (${found[0].path}).`,
    );
    console.log('Pass --browser or --path to pick another. Use --list to see all.');
  }
  return found[0];
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.list) {
    const found = findResInstalls(args.profile);
    if (found.length === 0) {
      console.log(`No RES LevelDB installs found for profile "${args.profile}".`);
      process.exit(1);
    }
    for (const item of found) {
      console.log(`${item.browser}\t${item.path}`);
    }
    process.exit(0);
  }

  const source = resolveSource(args);
  const { tags, total, kept } = await exportTags(source.path, {
    labeledOnly: args.labeledOnly,
  });

  const payload = {
    source: `${source.browser}-res-leveldb`,
    extensionId: RES_EXT_ID,
    browser: source.browser,
    profile: source.profile,
    exportedAt: new Date().toISOString(),
    count: kept,
    scanned: total,
    tags,
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(payload, null, 2));

  const publicOut = path.join(root, 'public/data/res-tags-seed.json');
  fs.mkdirSync(path.dirname(publicOut), { recursive: true });
  fs.copyFileSync(args.out, publicOut);

  console.log(
    `Wrote ${kept} tags (of ${total} tag.* keys) from ${source.label} → ${args.out}`,
  );
  console.log(`Copied seed → ${publicOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
