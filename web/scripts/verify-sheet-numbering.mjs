/**
 * Checks the numbers pins show on the sheet.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. A PIN'S NUMBER IS ITS PUNCH ITEM NUMBER. An arrow, box, cloud or photo
 *    drawn between two pins does not renumber the second — the bug found on
 *    the live site, where the pins read 1, 3, 4, 5 and the list 1, 2, 3, 4.
 * 2. A LATER SHEET CARRIES ON from the sheets before it, as the list and the
 *    issued schedule do, instead of starting again at 1.
 * 3. THE THREE PLACES A NUMBER APPEARS AGREE: the sheet, the punch list on
 *    screen and the schedule printed in the issued PDF.
 *
 * Run with: npm run verify -- numbering
 */
import assert from 'node:assert/strict';

import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import '../src/domain/flags/index.js';
import { ArrowMarkup } from '../src/domain/annotations/ArrowMarkup.js';
import { CloudMarkup } from '../src/domain/annotations/CloudMarkup.js';
import { MarkupStyle } from '../src/domain/annotations/MarkupStyle.js';
import { Pin } from '../src/domain/annotations/Pin.js';
import { RectangleMarkup } from '../src/domain/annotations/RectangleMarkup.js';
import { CalendarDate } from '../src/domain/details/CalendarDate.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import {
  PunchListRegistry,
  assignOrdinals,
  buildTaskList,
  ordinalsOnSheet,
} from '../src/domain/punchlist/index.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 1, 12, 0, clock++));
const sheet = (page) => `p2:sample-drawing-set.pdf#${page}`;

const pin = (id, page, label = id) => new Pin(id, sheet(page), new PdfPoint(100, 100), label, 'open', at());
const two = (Kind) => (id, page) =>
  new Kind(id, sheet(page), new PdfPoint(10, 10), new PdfPoint(60, 40), new MarkupStyle(), at());
const arrow = two(ArrowMarkup);
const box = two(RectangleMarkup);
const cloud = two(CloudMarkup);

/** The numbers the sheet shows for its pins, in the order the sheet lists them. */
const pinNumbers = (annotations, earlier) => {
  const ordinals = ordinalsOnSheet(annotations, earlier);
  return annotations.filter((a) => a.getKind() === 'pin').map((a) => ordinals.get(a));
};

// =========================================================================
// 1. A PIN'S NUMBER IS ITS PUNCH ITEM NUMBER
// =========================================================================

check('the live-site case: pin, arrow, pin, pin, pin, box, cloud reads 1 2 3 4 — not 1 3 4 5', () => {
  const marks = [pin('leak', 0), arrow('a', 0), pin('outlet', 0), pin('tile', 0), pin('door', 0), box('b', 0), cloud('c', 0)];
  assert.deepEqual(pinNumbers(marks), [1, 2, 3, 4]);
});

check('markups drawn before the first pin do not push its number up', () => {
  assert.deepEqual(pinNumbers([box('b', 0), cloud('c', 0), arrow('a', 0), pin('first', 0)]), [1]);
});

check('every kind counts only its own kind', () => {
  const marks = [box('b1', 0), pin('p1', 0), box('b2', 0), pin('p2', 0)];
  const ordinals = ordinalsOnSheet(marks);
  assert.deepEqual(marks.map((m) => ordinals.get(m)), [1, 1, 2, 2]);
});

// =========================================================================
// 2. A LATER SHEET CARRIES ON
// =========================================================================

check('the first sheet starts at 1', () => {
  assert.deepEqual(pinNumbers([pin('x', 0), pin('y', 0)], []), [1, 2]);
});

check('a later sheet carries on from the pins on the sheets before it', () => {
  const earlier = [pin('a', 0), box('b', 0), pin('c', 0), pin('d', 1)];
  assert.deepEqual(pinNumbers([pin('e', 2), arrow('f', 2), pin('g', 2)], earlier), [4, 5]);
});

check('the earlier sheets may arrive in any order — only how many pins they hold counts', () => {
  const earlier = [pin('a', 0), box('b', 0), pin('c', 0), pin('d', 1)];
  const shuffled = [earlier[3], earlier[1], earlier[0], earlier[2]];
  const here = [pin('e', 2), pin('g', 2)];
  assert.deepEqual(pinNumbers(here, shuffled), pinNumbers(here, earlier));
});

// =========================================================================
// 3. THE SHEET, THE LIST AND THE SCHEDULE AGREE
// =========================================================================

check('every pin shows the number the punch list and the issued schedule give it', () => {
  const pages = [
    [pin('s1-a', 0), arrow('s1-arrow', 0), pin('s1-b', 0), cloud('s1-cloud', 0)],
    [box('s2-box', 1), pin('s2-a', 1)],
    [pin('s3-a', 2), arrow('s3-arrow', 2), pin('s3-b', 2)],
  ];

  // The sheet: each page numbered with the pages before it as `earlier`.
  const onSheet = new Map();
  pages.forEach((marks, page) => {
    const ordinals = ordinalsOnSheet(marks, pages.slice(0, page).flat());
    for (const m of marks) if (m.getKind() === 'pin') onSheet.set(m.id, ordinals.get(m));
  });

  // The punch list on screen.
  const [drawing] = buildTaskList(pages.flat(), { today: CalendarDate.parse('2026-11-01') });
  const inList = new Map(drawing.items.map((item) => [item.id, item.number]));

  // The schedule the issued PDF prints, numbered the way the exporters number.
  const exportPages = pages.map((annotations, pageIndex) => ({ pageIndex, annotations }));
  const ordinals = assignOrdinals(exportPages);
  const onPaper = new Map(
    exportPages.flatMap(({ annotations }) =>
      annotations.filter((m) => m.getKind() === 'pin').map((m) => [m.id, ordinals.get(m)]),
    ),
  );

  assert.deepEqual([...onSheet.values()], [1, 2, 3, 4, 5]);
  assert.deepEqual(onSheet, inList, 'the sheet and the punch list');
  assert.deepEqual(onSheet, onPaper, 'the sheet and the issued PDF');
  assert.equal(PunchListRegistry.collect(exportPages, ordinals).length, 5);
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

console.log(`\n${checks.length - failed}/${checks.length} sheet numbering checks passed.`);
process.exit(failed === 0 ? 0 : 1);
