#!/usr/bin/env node
/**
 * Export RES user tags from Brave's LevelDB storage into JSON for Linchpin import.
 *
 * Usage:
 *   node scripts/export-res-tags.mjs
 *   node scripts/export-res-tags.mjs --out data/res-tags-seed.json
 *   node scripts/export-res-tags.mjs --profile Default --labeled-only
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

const RES_EXT_ID = 'kbmfpngjjgdllneeigpgjifpgocmfgmb';

function parseArgs(argv) {
  const args = {
    out: path.join(root, 'data/res-tags-seed.json'),
    profile: 'Default',
    labeledOnly: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--labeled-only') args.labeledOnly = true;
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--profile') args.profile = argv[++i];
  }
  return args;
}

function resDir(profile) {
  return path.join(
    os.homedir(),
    'Library/Application Support/BraveSoftware/Brave-Browser',
    profile,
    'Local Extension Settings',
    RES_EXT_ID,
  );
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

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Export RES tags from Brave LevelDB → JSON

Options:
  --out <path>         Output file (default: data/res-tags-seed.json)
  --profile <name>     Brave profile folder (default: Default)
  --labeled-only       Only tags with text/color/ignore/link
`);
    process.exit(0);
  }

  const src = resDir(args.profile);
  if (!fs.existsSync(src)) {
    console.error(`RES storage not found at:\n  ${src}`);
    console.error('Is Brave installed with RES (id kbmfpngjjgdllneeigpgjifpgocmfgmb)?');
    process.exit(1);
  }

  const copy = path.join(os.tmpdir(), `linchpin-leveldb-${Date.now()}`);
  fs.cpSync(src, copy, { recursive: true });

  // classic-level is an optional dep — install if missing
  let ClassicLevelCtor = ClassicLevel;
  try {
    if (!ClassicLevelCtor) {
      ({ ClassicLevel: ClassicLevelCtor } = await import('classic-level'));
    }
  } catch {
    console.error('Missing dependency: classic-level. Run: npm i -D classic-level');
    process.exit(1);
  }

  const db = new ClassicLevelCtor(copy, {
    createIfMissing: false,
    keyEncoding: 'utf8',
    valueEncoding: 'utf8',
  });
  await db.open();

  const tags = {};
  let total = 0;
  let kept = 0;

  for await (const [key, raw] of db.iterator()) {
    if (!key.startsWith('tag.')) continue;
    total++;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    if (args.labeledOnly && !hasLabelFields(value)) continue;
    const username = key.slice(4).toLowerCase();
    tags[username] = value;
    kept++;
  }

  await db.close();
  fs.rmSync(copy, { recursive: true, force: true });

  const payload = {
    source: 'brave-res-leveldb',
    extensionId: RES_EXT_ID,
    profile: args.profile,
    exportedAt: new Date().toISOString(),
    count: kept,
    scanned: total,
    tags,
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(payload, null, 2));

  // Also copy into public/ for extension packaging
  const publicOut = path.join(root, 'public/data/res-tags-seed.json');
  fs.mkdirSync(path.dirname(publicOut), { recursive: true });
  fs.copyFileSync(args.out, publicOut);

  console.log(`Wrote ${kept} tags (of ${total} tag.* keys) → ${args.out}`);
  console.log(`Copied seed → ${publicOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
