/**
 * Runs every verification suite — each `scripts/verify-*.mjs` — and fails if
 * any of them does.
 *
 * ===========================================================================
 * WHY SUITES ARE FOUND RATHER THAN LISTED
 * ===========================================================================
 * `npm run verify` used to be one long `&&` chain in package.json, and every
 * new suite meant editing that one line. Two branches that each added a suite
 * therefore always conflicted, whichever merged second — the same "edit a
 * shared list" problem the registries exist to remove from the application.
 *
 * So a suite is now a file and nothing else: name it `verify-<topic>.mjs` in
 * this folder and it runs. Each runs in its own Node process, exactly as it
 * would alone, so one suite's registrations cannot leak into another's.
 *
 * Usage
 *   npm run verify                  every suite
 *   npm run verify -- flags         only suites whose file name contains "flags"
 *   npm run verify -- details flags several filters, any may match
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const web = resolve(scripts, '..');
const filters = process.argv.slice(2);

const suites = readdirSync(scripts)
  .filter((file) => /^verify-.+\.mjs$/.test(file) && file !== 'verify-all.mjs')
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .sort();

if (suites.length === 0) {
  console.error(`No verification suite matches ${JSON.stringify(filters)}.`);
  process.exit(1);
}

const failed = [];

for (const file of suites) {
  console.log(`\n==> ${file}`);
  const run = spawnSync(
    process.execPath,
    ['--import', './scripts/register-resolver.mjs', join('scripts', file)],
    { cwd: web, stdio: 'inherit' },
  );
  if (run.status !== 0) failed.push(file);
}

console.log(
  failed.length === 0
    ? `\nAll ${suites.length} verification suites passed.`
    : `\n${failed.length} of ${suites.length} suites FAILED: ${failed.join(', ')}`,
);
process.exit(failed.length === 0 ? 0 : 1);
