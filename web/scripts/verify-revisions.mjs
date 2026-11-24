/**
 * Checks drawing revisions (SCRUM-90) and carrying open items forward to a
 * revised set (SCRUM-91, D7).
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. A REVISION GETS A NAME OF ITS OWN when the file arrives under one that is
 *    taken, and the library can say which set is current and what each
 *    revision replaced.
 * 2. ITEMS BELONG TO A SHEET NUMBER, NOT A PAGE: an open item on A-101 moves to
 *    whichever page of the revision is A-101 — same id, fields and history —
 *    and is flagged to have its place checked. Closed items stay with the set
 *    they were closed on. An open item that cannot move is listed, with why.
 * 3. THE FLAG IS STORED ON THE ITEM, so it survives a reload and is cleared by
 *    an ordinary edit ("Confirm the location of pin").
 * 4. THE ADAPTER speaks the server's language.
 *
 * Run with: npm run verify -- revisions
 */
import assert from 'node:assert/strict';

import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import '../src/domain/flags/index.js';
import '../src/domain/punchlist/index.js';
import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import { RectangleMarkup } from '../src/domain/annotations/RectangleMarkup.js';
import { MarkupStyle } from '../src/domain/annotations/MarkupStyle.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { CalendarDate } from '../src/domain/details/CalendarDate.js';
import { ItemFieldRegistry, LocationCheckField } from '../src/domain/details/index.js';
import { MarkupFlagRegistry, RevisedSheetFlag } from '../src/domain/flags/index.js';
import { LibraryDrawing } from '../src/domain/library/LibraryDrawing.js';
import { SheetName } from '../src/domain/sheets/SheetName.js';
import { RevisionLink, describeRevisions, planCarryForward, revisionNameFor } from '../src/domain/revisions/index.js';
import { HttpRevisionRepository } from '../src/infrastructure/revisions/HttpRevisionRepository.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// 1. NAMES AND HISTORY
// =========================================================================

check('a revision keeps its own file name, unless that name is taken', () => {
  assert.equal(revisionNameFor('Set rev B.pdf', ['Set.pdf']), 'Set rev B.pdf');
  assert.equal(revisionNameFor('Set.pdf', ['Set.pdf']), 'Set (rev 2).pdf');
  assert.equal(revisionNameFor('Set.pdf', ['Set.pdf', 'Set (rev 2).pdf']), 'Set (rev 3).pdf');
  assert.equal(revisionNameFor('Drawings', ['Drawings']), 'Drawings (rev 2)', 'no extension is fine');
});

const drawing = (id, name) => new LibraryDrawing({ id, name, byteSize: 1, uploadedAt: '2026-11-01T12:00:00Z' });

check('the library knows which set is current and what each revision replaced', () => {
  const sets = [drawing(1, 'Set.pdf'), drawing(2, 'Set (rev 2).pdf'), drawing(3, 'Set (rev 3).pdf'), drawing(4, 'Civil.pdf')];
  const links = [
    RevisionLink.fromJSON({ documentId: 2, revisionOf: 1, linkedAt: '2026-11-10T12:00:00Z' }),
    RevisionLink.fromJSON({ documentId: 3, revisionOf: 2, linkedAt: '2026-11-20T12:00:00Z' }),
  ];
  const history = describeRevisions(sets, links);
  assert.deepEqual(
    [1, 2, 3, 4].map((id) => {
      const { revision, replaces, replacedBy, isCurrent } = history.get(id);
      return [revision, replaces?.name ?? null, replacedBy?.name ?? null, isCurrent];
    }),
    [
      [1, null, 'Set (rev 2).pdf', false],
      [2, 'Set.pdf', 'Set (rev 3).pdf', false],
      [3, 'Set (rev 2).pdf', null, true],
      [1, null, null, true],
    ],
  );
});

// =========================================================================
// 2. CARRYING ITEMS FORWARD
// =========================================================================

const OLD = 'Set.pdf';
const NEW = 'Set (rev 2).pdf';
const sheetIdFor = (documentName, pageIndex) => `p7:${documentName}#${pageIndex}`;
const named = (pageIndex, number) => new SheetName({ pageIndex, number, title: `TITLE ${number}` });
const oldSheets = [named(0, 'A-101'), named(1, 'A-102'), named(2, 'A-104'), new SheetName({ pageIndex: 3 })];
// The revision reordered its pages and dropped A-104.
const newSheets = [named(0, 'A-001'), named(1, 'A102'), named(2, 'A-101')];

const pin = (id, page, status = PinStatus.OPEN, documentName = OLD) =>
  new Pin(id, sheetIdFor(documentName, page), new PdfPoint(120, 340), `Item ${id}`, status, new Date('2026-11-02T12:00:00Z'))
    .withDetail('trade', 'Drywall');

check('an open item moves to the page with its sheet number, keeping everything, flagged to be checked', () => {
  const item = pin('a', 0);
  const { moves, left } = planCarryForward({ items: [item], fromDocument: OLD, toDocument: NEW, fromSheets: oldSheets, toSheets: newSheets, sheetIdFor });
  assert.equal(left.length, 0);
  assert.equal(moves.length, 1);
  const [{ previous, next }] = moves;
  assert.equal(previous, item);
  assert.equal(next.id, 'a', 'the same item, so its history and comments follow it');
  assert.equal(next.sheetId, 'p7:Set (rev 2).pdf#2', 'A-101 is the third page of the revision');
  assert.equal(next.label, 'Item a');
  assert.equal(next.details.get('trade'), 'Drywall');
  assert.equal(next.createdAt.toISOString(), item.createdAt.toISOString(), 'it keeps its place in the numbering');
  assert.equal(next.details.get(LocationCheckField.KEY), OLD, 'flagged with the set it came from');
  assert.deepEqual([next.position.x, next.position.y], [120, 340], 'at the same spot, to be checked');
});

check('sheet numbers match however they are typed, and only open items move', () => {
  const ready = pin('b', 1, PinStatus.READY_FOR_REVIEW);
  const closed = pin('c', 1, PinStatus.CLOSED);
  const { moves } = planCarryForward({ items: [ready, closed], fromDocument: OLD, toDocument: NEW, fromSheets: oldSheets, toSheets: newSheets, sheetIdFor });
  assert.deepEqual(moves.map(({ next }) => [next.id, next.sheetId]), [['b', 'p7:Set (rev 2).pdf#1']], 'A-102 found as A102; the closed item stays');
});

check('an open item that cannot move is left where it is, with the reason', () => {
  const dropped = pin('d', 2);
  const unnumbered = pin('e', 3);
  const { moves, left } = planCarryForward({ items: [dropped, unnumbered], fromDocument: OLD, toDocument: NEW, fromSheets: oldSheets, toSheets: newSheets, sheetIdFor });
  assert.equal(moves.length, 0);
  assert.deepEqual(left.map(({ annotation, reason }) => [annotation.id, reason]), [
    ['d', 'A-104 is not in the revised set.'],
    ['e', 'Its sheet has no number to match.'],
  ]);
});

check('markups that are not items, and items on other drawings, are not touched', () => {
  const box = new RectangleMarkup('box', sheetIdFor(OLD, 0), new PdfPoint(1, 1), new PdfPoint(9, 9), new MarkupStyle(), new Date());
  const elsewhere = pin('f', 0, PinStatus.OPEN, 'Civil.pdf');
  const { moves, left } = planCarryForward({ items: [box, elsewhere], fromDocument: OLD, toDocument: NEW, fromSheets: oldSheets, toSheets: newSheets, sheetIdFor });
  assert.equal(moves.length + left.length, 0);
});

// =========================================================================
// 3. THE FLAG
// =========================================================================

check('the location check is an item field, after the other five, cleared by confirming', () => {
  assert.equal(ItemFieldRegistry.all().at(-1).getKey(), LocationCheckField.KEY);
  const field = ItemFieldRegistry.get(LocationCheckField.KEY);
  assert.equal(field.getInputKind(), 'confirm');
  assert.equal(field.normalize('  Set.pdf  '), 'Set.pdf');
  assert.equal(field.normalize(42), '');
  assert.equal(field.describeChange(''), 'Confirm the location of');
  assert.equal(field.describeChange('Set.pdf'), 'Flag the location of');
  assert.equal(field.format('Set.pdf'), 'Check - sheet revised from Set.pdf');
});

check('a carried item is flagged until its location is confirmed, and nothing else is', () => {
  const today = CalendarDate.fromLocalDate(new Date('2026-11-24T12:00:00'));
  const flagged = pin('g', 0).withDetail(LocationCheckField.KEY, OLD);
  const confirmed = flagged.withDetail(LocationCheckField.KEY, '');
  const ids = (annotation) => MarkupFlagRegistry.flagsFor(annotation, { today }).map((flag) => flag.getId());
  assert.ok(ids(flagged).includes(RevisedSheetFlag.ID));
  assert.ok(!ids(confirmed).includes(RevisedSheetFlag.ID));
  const flag = MarkupFlagRegistry.all().find((f) => f.getId() === RevisedSheetFlag.ID);
  assert.equal(flag.getTone(), 'warning');
  assert.match(flag.describe(flagged, { today }), /Sheet revised.*Set\.pdf/);
  assert.equal(flag.appliesTo({ getKind: () => 'odd' }, { today }), false, 'an odd markup does not throw');
});

// =========================================================================
// 4. ADAPTER
// =========================================================================

function fakeServer(respond) {
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url, 'http://localhost').pathname;
    requests.push({ method, path });
    const body = respond(method, path);
    return body === undefined
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { requests, fetchFn };
}

check('the revisions adapter lists the links and makes one', async () => {
  const server = fakeServer((method) => (method === 'GET' ? [{ documentId: 2, revisionOf: 1, linkedAt: '2026-11-10T12:00:00Z' }] : undefined));
  const repo = new HttpRevisionRepository('/api', server.fetchFn);
  const [link] = await repo.list(7);
  assert.deepEqual([link.documentId, link.revisionOf], [2, 1]);
  await repo.link(7, 3, 2);
  assert.deepEqual(server.requests.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/projects/7/revisions',
    'PUT /api/projects/7/documents/3/revision-of/2',
  ]);
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

console.log(`\n${checks.length - failed}/${checks.length} revision checks passed.`);
process.exit(failed === 0 ? 0 : 1);
