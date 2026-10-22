/**
 * Checks the punch list on screen (SCRUM-32, SCRUM-52).
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. THE NUMBERS ARE THE PINS' NUMBERS — and the issued schedule's. "Item 7"
 *    in the list is the pin with 7 in it on the drawing and line 7 on paper.
 * 2. ONLY PUNCH ITEMS ARE LISTED. A box or a cloud is drawn, not scheduled.
 * 3. THE FILTERS DO WHAT THEY SAY: status (including "still to do" and
 *    overdue), company, trade, "assigned to me" and free text — and they are
 *    not fooled by case or stray spaces.
 * 4. THE WHOLE PROJECT, BY DRAWING, with the drawing on screen first.
 *
 * Run with: npm run verify -- task
 */
import assert from 'node:assert/strict';

import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import '../src/domain/flags/index.js';
import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import { RectangleMarkup } from '../src/domain/annotations/RectangleMarkup.js';
import { MarkupStyle } from '../src/domain/annotations/MarkupStyle.js';
import { CalendarDate } from '../src/domain/details/CalendarDate.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import {
  PunchListRegistry,
  TaskFilter,
  assignOrdinals,
  buildTaskList,
  filterTaskList,
  taskListOptions,
} from '../src/domain/punchlist/index.js';
import { HttpProjectRepository } from '../src/infrastructure/auth/HttpProjectRepository.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const TODAY = CalendarDate.parse('2026-10-21');
let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 12, 0, clock++));

function pin(id, sheetId, label, { status = PinStatus.OPEN, ...details } = {}) {
  let p = new Pin(id, sheetId, new PdfPoint(100, 100), label, status, at());
  for (const [key, value] of Object.entries(details)) p = p.withDetail(key, value);
  return p;
}

const box = (id, sheetId) =>
  new RectangleMarkup(id, sheetId, new PdfPoint(10, 10), new PdfPoint(60, 40), new MarkupStyle(), at());

const A = (page) => `p1:A-101.pdf#${page}`;
const B = (page) => `p1:B-201.pdf#${page}`;

// Sheet order is the order the server returns: by sheet, then as listed.
const project = [
  pin('a1', A(0), 'Outlet cover missing', { trade: 'Electrical', responsibleCompany: 'Rivera Electric', assignee: 'Casey Collab', dueDate: '2026-10-10' }),
  box('a-box', A(0)),
  pin('a2', A(0), 'Door binds on frame', { status: PinStatus.READY_FOR_REVIEW, trade: 'Doors', responsibleCompany: 'Metro Drywall' }),
  pin('a3', A(1), 'Scuffed paint', { status: PinStatus.CLOSED, trade: 'Painting', responsibleCompany: 'rivera  electric' }),
  pin('b1', B(0), 'Missing ceiling tile', { trade: 'Acoustical Ceilings', responsibleCompany: 'Metro Drywall', assignee: 'casey collab' }),
];

// =========================================================================
// THE NUMBERS
// =========================================================================

check('the numbers are the pins\' numbers, and the issued schedule\'s', () => {
  const [a] = buildTaskList(project, { today: TODAY, openDocument: 'A-101.pdf' });

  const pages = [
    { pageIndex: 0, annotations: project.filter((x) => x.sheetId === A(0)) },
    { pageIndex: 1, annotations: project.filter((x) => x.sheetId === A(1)) },
  ];
  const schedule = PunchListRegistry.collect(pages, assignOrdinals(pages));

  assert.deepEqual(a.items.map((i) => i.number), [1, 2, 3]);
  assert.deepEqual(a.items.map((i) => i.number), schedule.map((e) => e.number), 'same as on paper');
  assert.deepEqual(a.items.map((i) => i.description), schedule.map((e) => e.description));
});

check('each drawing is numbered on its own, as each is issued on its own', () => {
  const groups = buildTaskList(project, { today: TODAY, openDocument: 'A-101.pdf' });
  const b = groups.find((g) => g.documentName === 'B-201.pdf');
  assert.deepEqual(b.items.map((i) => [i.id, i.number]), [['b1', 1]]);
});

check('only punch items are listed — the box is drawn, not scheduled', () => {
  const ids = buildTaskList(project, { today: TODAY }).flatMap((g) => g.items.map((i) => i.id));
  assert.ok(!ids.includes('a-box'));
  assert.equal(ids.length, 4);
});

check('the drawing on screen comes first, then the rest by name', () => {
  assert.deepEqual(buildTaskList(project, { today: TODAY, openDocument: 'B-201.pdf' }).map((g) => [g.documentName, g.isOpen]), [
    ['B-201.pdf', true],
    ['A-101.pdf', false],
  ]);
});

check('each row knows its sheet, status wording, details and flags', () => {
  const [a] = buildTaskList(project, { today: TODAY, openDocument: 'A-101.pdf' });
  const [first, second, third] = a.items;
  assert.equal(first.pageIndex, 0);
  assert.equal(third.pageIndex, 1);
  assert.equal(second.status, 'Ready for review');
  assert.equal(first.company, 'Rivera Electric');
  assert.equal(first.assignee, 'Casey Collab');
  assert.deepEqual([...first.flags], ['overdue'], 'open and due on the 10th');
  assert.deepEqual([...third.flags], [], 'closed work is never overdue');
});

// =========================================================================
// THE FILTERS
// =========================================================================

const groups = buildTaskList(project, { today: TODAY, openDocument: 'A-101.pdf' });
const ids = (filtered) => filtered.flatMap((g) => g.items.map((i) => i.id));

check('status: each status, everything still to do, and overdue', () => {
  assert.deepEqual(ids(filterTaskList(groups, { status: PinStatus.OPEN })), ['a1', 'b1']);
  assert.deepEqual(ids(filterTaskList(groups, { status: PinStatus.CLOSED })), ['a3']);
  assert.deepEqual(ids(filterTaskList(groups, { status: TaskFilter.OUTSTANDING })), ['a1', 'a2', 'b1']);
  assert.deepEqual(ids(filterTaskList(groups, { status: TaskFilter.OVERDUE })), ['a1']);
  assert.deepEqual(ids(filterTaskList(groups, {})), ['a1', 'a2', 'a3', 'b1']);
});

check('company and trade, whatever the case or spacing it was typed with', () => {
  assert.deepEqual(ids(filterTaskList(groups, { company: 'Rivera Electric' })), ['a1', 'a3']);
  assert.deepEqual(ids(filterTaskList(groups, { trade: 'doors' })), ['a2']);
});

check('assigned to me: my items, on every drawing', () => {
  assert.deepEqual(ids(filterTaskList(groups, { assignedTo: 'Casey Collab' })), ['a1', 'b1']);
  assert.deepEqual(ids(filterTaskList(groups, { assignedTo: 'Avery Admin' })), []);
});

check('free text finds a word anywhere — or the item\'s number', () => {
  assert.deepEqual(ids(filterTaskList(groups, { query: 'ceiling' })), ['b1']);
  assert.deepEqual(ids(filterTaskList(groups, { query: 'METRO door' })), ['a2']);
  assert.deepEqual(ids(filterTaskList(groups, { query: '3' })), ['a3']);
});

check('a drawing with nothing left after filtering is not shown at all', () => {
  assert.deepEqual(filterTaskList(groups, { trade: 'Doors' }).map((g) => g.documentName), ['A-101.pdf']);
});

check('the filter menus list each company and trade once, sorted', () => {
  const { companies, trades } = taskListOptions(groups);
  assert.deepEqual(companies, ['Metro Drywall', 'Rivera Electric'], 'not "rivera  electric" as well');
  assert.deepEqual(trades, ['Acoustical Ceilings', 'Doors', 'Electrical', 'Painting']);
});

// =========================================================================
// FROM THE SERVER
// =========================================================================

check('the project\'s items come from one request, and a kind this build does not know is skipped', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return new Response(
      JSON.stringify([
        project[0].toJSON(),
        { ...project[0].toJSON(), id: 'future', kind: 'hologram' },
      ]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const items = await new HttpProjectRepository('/api', fetchFn).items(1);
  assert.deepEqual(calls, ['/api/projects/1/items']);
  assert.deepEqual(items.map((a) => a.id), ['a1']);
  assert.ok(items[0] instanceof Pin);
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

console.log(`\n${checks.length - failed}/${checks.length} task list checks passed.`);
process.exit(failed === 0 ? 0 : 1);
