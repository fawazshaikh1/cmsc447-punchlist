/**
 * Checks that sheets are named the way the drawing names them.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. A SHEET'S NUMBER AND TITLE ARE READ FROM ITS TITLE BLOCK — "A-101" and
 *    "LEVEL 1 FLOOR PLAN", where the drawing labels them, and from the
 *    largest sheet number in the bottom-right corner where it does not. The
 *    fixtures are the sample set's own title block (web/public/
 *    sample-drawing-set.pdf, page 1, 2592 × 1728 pt).
 * 2. NOTHING ELSE ON THE SHEET IS TAKEN FOR ITS NUMBER: grid bubbles, room
 *    numbers, dimensions, dates, or a note saying "SEE A-501".
 * 3. A NAME SOMEONE TYPED IS NEVER OVERWRITTEN by a later reading of the
 *    drawing, and a page with no name reads "Sheet N" as it always has.
 * 4. THE ADAPTERS CARRY THIS FAITHFULLY: pdf.js text positions become the
 *    page-as-seen positions the reader expects, on a turned page too, and
 *    names reach the server under the drawing's name, escaped.
 *
 * Run with: npm run verify -- sheet-names
 */
import assert from 'node:assert/strict';

import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import '../src/domain/flags/index.js';
import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import { CalendarDate } from '../src/domain/details/CalendarDate.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { PunchListRegistry, buildTaskList } from '../src/domain/punchlist/index.js';
import { SheetName, SheetNames, findSheetName } from '../src/domain/sheets/index.js';
import { readSheetNames } from '../src/infrastructure/pdf/readSheetNames.js';
import { toSheetTextItems } from '../src/infrastructure/pdf/sheetTextItems.js';
import { HttpSheetNameRepository } from '../src/infrastructure/sheets/HttpSheetNameRepository.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// 1-2. READING THE TITLE BLOCK
// =========================================================================

const SAMPLE_PAGE = { width: 2592, height: 1728 };

/** Page 1 of the sample set, top-left coordinates, plus look-alikes. */
const SAMPLE = [
  { text: 'SHEET TITLE', x: 2322, y: 1598, size: 6.5 },
  { text: 'LEVEL 1 FLOOR PLAN', x: 2322, y: 1610, size: 12 },
  { text: 'SHEET NUMBER', x: 2322, y: 1640, size: 6.5 },
  { text: 'A-101', x: 2322, y: 1654, size: 26 },
  // Look-alikes the reader must step over.
  { text: 'A', x: 2009, y: 1341, size: 10 },
  { text: '6', x: 1918, y: 1433, size: 10 },
  { text: '101', x: 640, y: 470, size: 8 },
  { text: '23\'-4"', x: 1771, y: 1374, size: 7.5 },
  { text: '2026-09-24', x: 2322, y: 420, size: 6 },
  { text: 'SEE A-501', x: 300, y: 200, size: 9 },
  // The same title under the drawing, far from the title block.
  { text: 'LEVEL 1 FLOOR PLAN', x: 66, y: 1640, size: 14 },
];

check('reads A-101 and LEVEL 1 FLOOR PLAN from a labelled title block', () =>
  assert.deepEqual(findSheetName(SAMPLE, SAMPLE_PAGE), { number: 'A-101', title: 'LEVEL 1 FLOOR PLAN' }));

check('reads a number written to the right of its label', () =>
  assert.equal(
    findSheetName(
      [
        { text: 'SHEET NO.', x: 2300, y: 1600, size: 7 },
        { text: 'E-101', x: 2360, y: 1598, size: 14 },
      ],
      SAMPLE_PAGE,
    ).number,
    'E-101',
  ));

check('without labels, takes the largest designator in the bottom-right third', () =>
  assert.deepEqual(
    findSheetName(
      [
        { text: 'M-201', x: 2400, y: 1650, size: 24 },
        { text: 'S-1', x: 2400, y: 1700, size: 8 },
        { text: 'A-501', x: 300, y: 200, size: 10 },
        { text: 'MECHANICAL PLAN', x: 2380, y: 1620, size: 12 },
      ],
      SAMPLE_PAGE,
    ),
    { number: 'M-201', title: 'MECHANICAL PLAN' },
  ));

check('grid bubbles, room numbers, dimensions and dates are not sheet numbers', () =>
  assert.equal(findSheetName(SAMPLE.slice(4, 9), SAMPLE_PAGE), null));

check('a page with no title block has no name', () => assert.equal(findSheetName([], SAMPLE_PAGE), null));

// =========================================================================
// 3. NAMES KEPT, AND THE FALLBACK
// =========================================================================

check('labels read "A-101 · LEVEL 1 FLOOR PLAN", or Sheet N when nothing is known', () => {
  const names = new SheetNames([new SheetName({ pageIndex: 0, number: 'A-101', title: 'LEVEL 1 FLOOR PLAN' })]);
  assert.equal(names.labelFor(0), 'A-101 · LEVEL 1 FLOOR PLAN');
  assert.equal(names.numberFor(0), 'A-101');
  assert.equal(names.labelFor(2), 'Sheet 3');
  assert.equal(names.numberFor(2), 'Sheet 3');
});

check('an edited name survives a later detection', () => {
  const edited = new SheetNames().withEdited(new SheetName({ pageIndex: 0, number: 'A-100', source: 'edited' }));
  const after = edited.withDetected([
    new SheetName({ pageIndex: 0, number: 'A-101' }),
    new SheetName({ pageIndex: 1, number: 'A-102' }),
  ]);
  assert.equal(after.numberFor(0), 'A-100');
  assert.equal(after.numberFor(1), 'A-102');
});

check('missing pages skip any stored name, even an edited empty one', () =>
  assert.deepEqual(new SheetNames([new SheetName({ pageIndex: 1, source: 'edited' })]).missingPages(3), [0, 2]));

check('names are tidied, capped and checked', () => {
  const name = new SheetName({ pageIndex: 0, number: '  A-101  ', title: 'LEVEL   1\nPLAN' });
  assert.equal(name.number, 'A-101');
  assert.equal(name.title, 'LEVEL 1 PLAN');
  assert.equal(new SheetName({ pageIndex: 0, number: 'X'.repeat(50) }).number.length, 40);
  assert.throws(() => new SheetName({ pageIndex: -1 }), TypeError);
  assert.throws(() => new SheetName({ pageIndex: 0, source: 'guessed' }), TypeError);
  assert.deepEqual(SheetName.fromJSON(name.toJSON()), name);
});

// =========================================================================
// 4. THE ADAPTERS
// =========================================================================

check('pdf.js positions become top-left page positions on an upright page', () =>
  // pdf.js puts A-101 26 pt high with its baseline 48 pt up the page; the
  // upright viewport flips y, so its top edge is 1728 - 48 - 26 from the top.
  assert.deepEqual(toSheetTextItems([{ str: 'A-101', transform: [26, 0, 0, 26, 2322, 48] }], [1, 0, 0, -1, 0, 1728]), [
    { text: 'A-101', x: 2322, y: 1654, size: 26 },
  ]));

check('…and on a page turned 90 degrees', () => {
  const [item] = toSheetTextItems([{ str: 'A-101', transform: [26, 0, 0, 26, 2322, 48] }], [0, 1, 1, 0, 0, 0]);
  assert.equal(item.x, 48);
  assert.equal(item.size, 26);
});

check('the reader names each page and lets pdf.js go through its loading task', async () => {
  // pdf.js 6 has no destroy() on the document — only on the loading task. The
  // first version of the reader called the document's and threw, so no
  // drawing was ever named (found in the browser, 2026-11-04).
  let released = false;
  const page = {
    getViewport: () => ({ transform: [1, 0, 0, -1, 0, 1728], width: 2592, height: 1728 }),
    getTextContent: async () => ({
      items: [
        { str: 'SHEET NUMBER', transform: [6.5, 0, 0, 6.5, 2322, 82] },
        { str: 'A-101', transform: [26, 0, 0, 26, 2322, 48] },
      ],
    }),
    cleanup() {},
  };
  const loadingTask = {
    promise: Promise.resolve({ numPages: 2, getPage: async () => page }),
    destroy: async () => {
      released = true;
    },
  };

  const names = await readSheetNames(loadingTask);
  assert.deepEqual(names.map((name) => [name.pageIndex, name.number]), [[0, 'A-101'], [1, 'A-101']]);
  assert.equal(released, true);
});

/** A drawing name that needs escaping in a path: spaces, '%' and '&'. */
const DRAWING = 'A-101 100% CD set & stairs.pdf';

check('the HTTP adapter reads every drawing and saves one', async () => {
  const requests = [];
  const bodies = [];
  const fake = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    requests.push(`${method} ${new URL(url, 'http://localhost').pathname}`);
    if (init.body) bodies.push(JSON.parse(init.body));
    const body =
      method === 'GET'
        ? { [DRAWING]: [{ pageIndex: 0, number: 'A-101', title: 'LEVEL 1 FLOOR PLAN', source: 'detected' }] }
        : [
            { pageIndex: 0, number: 'A-101', title: 'LEVEL 1 FLOOR PLAN', source: 'detected' },
            { pageIndex: 1, number: 'A-102', title: '', source: 'detected' },
          ];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const repo = new HttpSheetNameRepository('/api', fake);
  const all = await repo.listForProject(7);
  assert.equal(all.get(DRAWING).numberFor(0), 'A-101');
  assert.equal(requests.at(-1), 'GET /api/projects/7/sheet-names');

  const saved = await repo.save(7, DRAWING, {
    source: 'detected',
    names: [new SheetName({ pageIndex: 1, number: 'A-102' })],
  });
  assert.equal(requests.at(-1), 'PUT /api/projects/7/sheet-names/A-101%20100%25%20CD%20set%20%26%20stairs.pdf');
  assert.deepEqual(bodies.at(-1), { source: 'detected', names: [{ pageIndex: 1, number: 'A-102', title: '' }] });
  assert.equal(saved.numberFor(1), 'A-102');
});

// =========================================================================
// 5. WHERE THE NAMES ARE SHOWN
// =========================================================================

const TODAY = CalendarDate.parse('2026-11-04');
let clock = 0;
const pinOnPage = (page) =>
  new Pin(`pin-${page}`, `set.pdf#${page}`, new PdfPoint(100, 100), `Item on page ${page + 1}`, PinStatus.OPEN,
    new Date(Date.UTC(2026, 10, 1, 12, 0, clock++)));

check('punch list items carry the sheet number they are given, or Sheet N', () => {
  const groups = buildTaskList([pinOnPage(0), pinOnPage(1)], {
    today: TODAY,
    openDocument: 'set.pdf',
    sheetLabelFor: (documentName, page) => (page === 0 ? 'A-101' : `Sheet ${page + 1}`),
  });
  assert.deepEqual(groups[0].items.map((item) => item.sheetLabel), ['A-101', 'Sheet 2']);
});

check('the issued schedule prints the sheet number it is given, and Sheet N without one', () => {
  const entries = PunchListRegistry.collect([
    { pageIndex: 0, annotations: [pinOnPage(0)], sheetLabel: 'A-101' },
    { pageIndex: 1, annotations: [pinOnPage(1)] },
  ]);
  assert.deepEqual(entries.map((entry) => entry.sheetLabel), ['A-101', 'Sheet 2']);
});

check('a relabelled schedule entry keeps everything else', () => {
  const [entry] = PunchListRegistry.collect([{ pageIndex: 0, annotations: [pinOnPage(0)] }]);
  const relabelled = entry.withSheetLabel('A-101');
  assert.equal(relabelled.sheetLabel, 'A-101');
  assert.equal(relabelled.number, entry.number);
  assert.equal(relabelled.description, entry.description);
  assert.deepEqual(relabelled.details, entry.details);
  assert.ok(Object.isFrozen(relabelled));
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

console.log(`\n${checks.length - failed}/${checks.length} sheet name checks passed.`);
process.exit(failed === 0 ? 0 : 1);
