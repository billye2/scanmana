// Bump the release version (taskmana-mobile scheme: each segment counts 0-9,
// 1.0.9 -> 1.1.0). Keeps package.json and the visible version line on /help
// (lib/version.ts) in step. Unlike taskmana-mobile there is no sw.js cache key
// to advance: Scanmana's service worker is push-only and precaches nothing.
// Usage: npm run bump   — then put "(x.y.z)" in the release commit title.
import { readFileSync, writeFileSync } from 'node:fs';
import { bumpVersion } from './version-lib.mjs';

const json = JSON.parse(readFileSync('package.json', 'utf8'));
const next = bumpVersion(json.version);
json.version = next;
writeFileSync('package.json', JSON.stringify(json, null, 2) + '\n');
console.log(`package.json: -> ${next}`);

const lib = readFileSync('lib/version.ts', 'utf8');
writeFileSync('lib/version.ts', lib.replace(/APP_VERSION = "[^"]+"/, `APP_VERSION = "${next}"`));
console.log(`lib/version.ts: -> ${next}`);
