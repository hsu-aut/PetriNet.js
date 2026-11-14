/**
 * Runs every browser check in this folder, one after the other, each in a
 * process of its own so that one that hangs or throws does not take the rest
 * with it. Exits non-zero when any of them failed.
 *
 *   node test/browser/run.mjs [name ...]   only the checks whose file name has a name in it
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);

const files = readdirSync(here)
  .filter((name) => /^(verify-.*|roundtrip)\.mjs$/.test(name))
  .filter((name) => only.length === 0 || only.some((part) => name.includes(part)))
  .sort();

if (files.length === 0) {
  console.error('no browser check matches');
  process.exit(1);
}

const failed = [];
for (const name of files) {
  console.log(`\n== ${name}`);
  const run = spawnSync(process.execPath, [resolve(here, name)], { stdio: 'inherit', timeout: 120000 });
  if (run.status !== 0) failed.push(name);
}

console.log(failed.length === 0
  ? `\nall ${files.length} browser checks passed`
  : `\n${failed.length} of ${files.length} browser checks failed: ${failed.join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
