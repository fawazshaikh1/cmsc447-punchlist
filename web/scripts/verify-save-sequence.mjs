/**
 * Checks that quick edits to a punch item are all kept.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. SAVES REACH STORAGE IN THE ORDER THEY WERE MADE, however long each one
 *    takes on the network. Unordered, a slow first save lands last and
 *    overwrites the second — found on the live site, where a pin's trade,
 *    company, assignee and due date, filled in one after another, came back
 *    with only the company and the due date.
 * 2. A READ NEVER PUTS AN OLDER COPY BACK ON SCREEN — not after a newer read,
 *    and not while a save is still on its way.
 * 3. EDITS BUILT ON THE ITEM ON SCREEN KEEP EVERY FIELD, because each one is
 *    built on the last and saved in turn.
 *
 * The screen half — an edit shown before its round trip, and the overdue flag
 * appearing as the due date field is left — was checked in the browser.
 *
 * Run with: npm run verify -- save-sequence
 */
import assert from 'node:assert/strict';

import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { SaveSequence } from '../src/presentation/hooks/SaveSequence.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Storage reached over a network: each save takes as long as it is told to. */
function slowStore(initial) {
  const store = { value: initial, landed: [] };
  store.save = async (value, latency) => {
    await sleep(latency);
    store.value = value;
    store.landed.push(value);
  };
  return store;
}

// =========================================================================
// 1. SAVES IN ORDER
// =========================================================================

check('without ordering, a slow first save overwrites the second — the bug', async () => {
  const store = slowStore('original');
  await Promise.all([store.save('first edit', 60), store.save('second edit', 5)]);
  assert.equal(store.value, 'first edit', 'the newer edit was lost');
});

check('saves reach storage in the order they were made, whatever each takes', async () => {
  const store = slowStore('original');
  const saves = new SaveSequence();
  await Promise.all([
    saves.write(() => store.save('first edit', 60)),
    saves.write(() => store.save('second edit', 5)),
    saves.write(() => store.save('third edit', 20)),
  ]);
  assert.deepEqual(store.landed, ['first edit', 'second edit', 'third edit']);
  assert.equal(store.value, 'third edit');
});

check('a failed save is reported to its caller, and the saves after it still run', async () => {
  const store = slowStore('original');
  const saves = new SaveSequence();
  const refused = saves.write(async () => {
    await sleep(10);
    throw new Error('Your role on this project does not allow that change.');
  });
  const next = saves.write(() => store.save('next edit', 5));
  await assert.rejects(refused, /does not allow/);
  await next;
  assert.equal(store.value, 'next edit');
  assert.equal(saves.pending, 0);
});

// =========================================================================
// 2. READS NEVER GO BACKWARDS
// =========================================================================

check('a read overtaken by a newer read is not shown', () => {
  const saves = new SaveSequence();
  const older = saves.read();
  const newer = saves.read();
  assert.equal(older(), false);
  assert.equal(newer(), true);
});

check('a read is not shown while a save is queued or on its way — and is once they land', async () => {
  const saves = new SaveSequence();
  const inFlight = saves.write(() => sleep(30));
  const during = saves.read();
  assert.equal(during(), false, 'a save is still on its way');
  await inFlight;
  assert.equal(during(), true, 'nothing newer has happened since');
  const after = saves.read();
  assert.equal(after(), true);
});

check('a read started before a save is overtaken by it, even after the save lands', async () => {
  const saves = new SaveSequence();
  const before = saves.read();
  await saves.write(() => sleep(5));
  // The save's own read, which the editor always makes, is the one to show.
  const own = saves.read();
  assert.equal(before(), false);
  assert.equal(own(), true);
});

// =========================================================================
// 3. EVERY FIELD OF A QUICKLY FILLED-IN ITEM IS KEPT
// =========================================================================

const FIELDS = [
  ['trade', 'Doors & Hardware', 80],
  ['responsibleCompany', 'Metro Door Co.', 10],
  ['assignee', 'Saumya Patel', 50],
  ['dueDate', '2026-10-28', 5],
];

const freshPin = () =>
  new Pin('pin-5', 'p2:sample-drawing-set.pdf#0', new PdfPoint(100, 100), 'Fire door closer missing', PinStatus.OPEN, new Date(Date.UTC(2026, 10, 1)));

check('the live-site case, as it was: each edit built on the copy from before the last save', async () => {
  const pin = freshPin();
  const store = slowStore(pin);
  // The panel's copy never caught up between fields, and nothing ordered the saves.
  await Promise.all(FIELDS.map(([key, value, latency]) => store.save(pin.withDetail(key, value), latency)));
  const kept = FIELDS.filter(([key, value]) => store.value.details.get(key) === value).length;
  assert.ok(kept < FIELDS.length, 'some fields should have been lost');
});

check('as fixed: each edit built on the last and saved in turn keeps all four fields', async () => {
  const store = slowStore(freshPin());
  const saves = new SaveSequence();
  let onScreen = store.value;
  const writes = [];
  for (const [key, value, latency] of FIELDS) {
    // What ItemDetailsEditor does: build on the newest copy it has made.
    const next = onScreen.withDetail(key, value);
    onScreen = next;
    writes.push(saves.write(() => store.save(next, latency)));
  }
  await Promise.all(writes);
  for (const [key, value] of FIELDS) assert.equal(store.value.details.get(key), value, key);
});

// --- run --------------------------------------------------------------------

let failed = 0;

for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message.split('\n').join('\n        ')}`);
  }
}

console.log(`\n${checks.length - failed}/${checks.length} save sequence checks passed.`);
process.exit(failed === 0 ? 0 : 1);
