/**
 * Checks the Tasks tab's rules (spec 6): every task in the project in one
 * list, sorted, grouped and filtered, with a priority, created on a sheet or
 * off one, edited in bulk as one undo step, and exported to CSV.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. PRIORITY IS A FIELD LIKE ANY OTHER — High, Medium or Low — and an item
 *    that never had one reads as Medium, so nothing old has to be rewritten.
 * 2. A TASK CAN LIVE OFF THE DRAWINGS, numbered G-1, G-2 in the order it was
 *    made, and becomes a pin when it is placed, keeping its id and fields.
 * 3. THE LIST SORTS, GROUPS AND FILTERS the way a project manager works
 *    through it: by sheet by default, then by status, priority, due date or
 *    last change, with filters that combine.
 * 4. A BULK EDIT IS ONE UNDO STEP, and the tasks it may not change — issued,
 *    or beyond the person's role — are skipped and named, not failed.
 * 5. THE CSV OPENS CLEANLY IN EXCEL: a byte-order mark, quoting that survives
 *    commas, quotes and new lines, and no text that Excel would run.
 *
 * Run with: npm run verify -- tasks-tab
 */
import assert from 'node:assert/strict';

import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import '../src/domain/flags/index.js';
import '../src/domain/punchlist/index.js';
import '../src/domain/rules/index.js';
import { OffSheetTask, Pin, PinStatus, TASK_KIND } from '../src/domain/annotations/index.js';
import { AnnotationRegistry } from '../src/domain/annotations/AnnotationRegistry.js';
import { ChangeRecord } from '../src/domain/audit/ChangeRecord.js';
import { CalendarDate, PriorityField } from '../src/domain/details/index.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { CounterIdGenerator } from '../src/domain/identity/CounterIdGenerator.js';
import { StaticIdentityProvider } from '../src/domain/identity/StaticIdentityProvider.js';
import { CompositeEditPolicy, RoleEditPolicy, SealedByExportPolicy } from '../src/domain/policy/index.js';
import { AnnotationRuleRegistry } from '../src/domain/rules/index.js';
import { EditorService } from '../src/domain/services/EditorService.js';
import {
  OFF_SHEET_DOCUMENT,
  buildTaskRows,
  filterTaskRows,
  groupTaskRows,
  isOffSheet,
  sortTaskRows,
  taskCsv,
} from '../src/domain/tasks/index.js';
import { InMemoryAnnotationRepository } from '../src/infrastructure/persistence/InMemoryAnnotationRepository.js';
import { HttpTaskRepository } from '../src/infrastructure/tasks/HttpTaskRepository.js';
import { InMemoryChangeLogRepository } from '../src/infrastructure/persistence/InMemoryChangeLogRepository.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const TODAY = CalendarDate.parse('2026-11-10');
const SHEET_1 = 'p7:A.pdf#0';
const SHEET_2 = 'p7:A.pdf#1';
const TASKS = `p7:${OFF_SHEET_DOCUMENT}#0`;
let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 1, 12, 0, clock++));

const pin = (id, sheetId, label, { status = PinStatus.OPEN, details = {} } = {}) => {
  let made = new Pin(id, sheetId, new PdfPoint(100, 100), label, status, at());
  for (const [key, value] of Object.entries(details)) made = made.withDetail(key, value);
  return made;
};
const task = (id, label, { status = PinStatus.OPEN, details = {} } = {}) => {
  let made = new OffSheetTask(id, TASKS, label, status, at());
  for (const [key, value] of Object.entries(details)) made = made.withDetail(key, value);
  return made;
};
const labels = (documentName, pageIndex) => (pageIndex === 0 ? 'A-101' : 'A-102');
const rowsOf = (annotations, extra = {}) => buildTaskRows(annotations, { today: TODAY, sheetLabelFor: labels, ...extra });

// =========================================================================
// 1. PRIORITY
// =========================================================================

check('an item with no priority reads as Medium; High, Medium and Low are kept, in any case', () => {
  const field = new PriorityField();
  assert.equal(PriorityField.of(''), 'medium');
  assert.equal(field.normalize('HIGH'), 'high');
  assert.equal(field.normalize(' low '), 'low');
  assert.equal(field.normalize('urgent'), '');
  assert.equal(field.format('high'), 'High');
  assert.deepEqual(field.getChoices().map(([value]) => value), ['high', 'medium', 'low']);
  assert.equal(field.getInputKind(), 'choice');
});

check('a pin keeps the priority it is given, and the schedule prints it', () => {
  const urgent = pin('p1', SHEET_1, 'Leak', { details: { priority: 'High' } });
  assert.equal(urgent.details.get('priority'), 'high');
  assert.deepEqual(
    urgent.details.labelled().find((detail) => detail.key === 'priority'),
    { key: 'priority', label: 'Priority', value: 'High' },
  );
});

// =========================================================================
// 2. TASKS OFF THE DRAWINGS
// =========================================================================

check('an off-sheet task survives storage and needs a description', () => {
  const made = task('t1', 'Order replacement ceiling tiles', { details: { trade: 'Ceilings', priority: 'low' } });
  const back = AnnotationRegistry.fromJSON(JSON.parse(JSON.stringify(made.toJSON())));
  assert.ok(back instanceof OffSheetTask);
  assert.equal(back.getKind(), TASK_KIND);
  assert.equal(back.label, 'Order replacement ceiling tiles');
  assert.equal(back.details.get('trade'), 'Ceilings');
  assert.equal(back.movedBy(10, 10), back, 'a task off the drawings has nowhere to move');
  assert.equal(AnnotationRuleRegistry.isComplete(task('t2', '  ')), false);
  assert.ok(isOffSheet(TASKS) && !isOffSheet(SHEET_1));
});

check('placing a task makes a pin with the same id, description, status, fields and age', () => {
  const made = task('t1', 'Patch hole by door', { status: PinStatus.READY_FOR_REVIEW, details: { responsibleCompany: 'Metro Drywall' } });
  const placed = made.placedAt(SHEET_2, new PdfPoint(72, 72));
  assert.ok(placed instanceof Pin);
  assert.equal(placed.id, 't1');
  assert.equal(placed.sheetId, SHEET_2);
  assert.equal(placed.label, 'Patch hole by door');
  assert.equal(placed.status, PinStatus.READY_FOR_REVIEW);
  assert.equal(placed.details.get('responsibleCompany'), 'Metro Drywall');
  assert.equal(placed.createdAt.getTime(), made.createdAt.getTime());
});

check('off-sheet tasks are numbered G-1, G-2 in the order they were made, after the sheets', () => {
  const rows = sortTaskRows(
    rowsOf([task('t1', 'First'), pin('p1', SHEET_1, 'On the sheet'), task('t2', 'Second')]),
    'sheet',
  );
  assert.deepEqual(rows.map((row) => row.number), ['1', 'G-1', 'G-2']);
  assert.deepEqual(rows.map((row) => row.sheetLabel), ['A-101', 'Not on a sheet', 'Not on a sheet']);
});

// =========================================================================
// 3. SORTING, GROUPING, FILTERING
// =========================================================================

const project = () => [
  pin('p1', SHEET_2, 'Paint touch-up', { details: { priority: 'low', responsibleCompany: 'Bright Paint', dueDate: '2026-11-20' } }),
  pin('p2', SHEET_1, 'Fire door closer', { status: PinStatus.CLOSED, details: { priority: 'high', responsibleCompany: 'Metro Door' } }),
  pin('p3', SHEET_1, 'Ceiling tile stained', { details: { responsibleCompany: 'Metro Drywall', dueDate: '2026-11-01', assignee: 'Casey Collab' } }),
  task('t1', 'Order tiles', { status: PinStatus.READY_FOR_REVIEW, details: { priority: 'high', dueDate: '2026-11-15' } }),
];

check('sorting by sheet is the default: drawing, page, then pin number; anything unknown sorts by sheet', () => {
  const ids = (key) => sortTaskRows(rowsOf(project()), key).map((row) => row.id);
  assert.deepEqual(ids('sheet'), ['p2', 'p3', 'p1', 't1']);
  assert.deepEqual(ids('no-such-sort'), ['p2', 'p3', 'p1', 't1']);
});

check('sorting by priority, status and due date (no date last)', () => {
  const ids = (key) => sortTaskRows(rowsOf(project()), key).map((row) => row.id);
  assert.deepEqual(ids('priority'), ['p2', 't1', 'p3', 'p1']);
  assert.deepEqual(ids('status'), ['p3', 'p1', 't1', 'p2']);
  assert.deepEqual(ids('dueDate'), ['p3', 't1', 'p1', 'p2']);
});

check('sorting by last update puts the most recent first, never-changed last', () => {
  const change = (annotationId, iso) =>
    new ChangeRecord({ id: `c-${annotationId}`, annotationId, sheetId: SHEET_1, intent: 'update', actor: Actor.ANONYMOUS, at: iso });
  const lastChanges = new Map([
    ['p1', change('p1', '2026-11-09T10:00:00Z')],
    ['t1', change('t1', '2026-11-10T09:00:00Z')],
  ]);
  const ids = sortTaskRows(rowsOf(project(), { lastChanges }), 'updated').map((row) => row.id);
  assert.deepEqual(ids, ['t1', 'p1', 'p2', 'p3']);
});

check('grouping by sheet, status, priority and company, each group in a sensible order', () => {
  const groups = (key) =>
    groupTaskRows(sortTaskRows(rowsOf(project()), 'sheet'), key).map((group) => [group.label, group.rows.map((row) => row.id)]);
  assert.deepEqual(groups('sheet'), [
    ['A-101 — A.pdf', ['p2', 'p3']],
    ['A-102 — A.pdf', ['p1']],
    ['Not on a sheet', ['t1']],
  ]);
  assert.deepEqual(groups('priority'), [['High', ['p2', 't1']], ['Medium', ['p3']], ['Low', ['p1']]]);
  assert.deepEqual(groups('status').map(([label]) => label), ['Open', 'Ready for review', 'Closed']);
  assert.deepEqual(groups('company').map(([label]) => label), ['Bright Paint', 'Metro Door', 'Metro Drywall', 'No company']);
  assert.deepEqual(groups('none'), [['', ['p2', 'p3', 'p1', 't1']]]);
});

check('filters combine: still to do, priority, company, assigned to me and words', () => {
  const ids = (filters) => filterTaskRows(rowsOf(project()), filters).map((row) => row.id).sort();
  assert.deepEqual(ids({ status: 'outstanding' }), ['p1', 'p3', 't1']);
  assert.deepEqual(ids({ status: 'overdue' }), ['p3']);
  assert.deepEqual(ids({ priority: 'high' }), ['p2', 't1']);
  assert.deepEqual(ids({ priority: 'medium' }), ['p3']);
  assert.deepEqual(ids({ status: 'outstanding', priority: 'high' }), ['t1']);
  assert.deepEqual(ids({ company: 'metro  door' }), ['p2']);
  assert.deepEqual(ids({ assignedTo: 'casey collab' }), ['p3']);
  assert.deepEqual(ids({ query: 'tile' }), ['p3', 't1']);
  assert.deepEqual(ids({ query: 'G-1' }), ['t1']);
});

check('an issued task is marked locked in the list', () => {
  const rows = rowsOf(project(), { sealedIds: new Set(['p2']) });
  assert.deepEqual(rows.filter((row) => row.isLocked).map((row) => row.id), ['p2']);
});

// =========================================================================
// 4. BULK EDIT
// =========================================================================

const person = (role) => new Actor({ id: `u-${role}`, displayName: `Person ${role}`, company: 'Co', role });

async function editorWith(annotations, { role = 'admin', sealed = [] } = {}) {
  const repository = new InMemoryAnnotationRepository();
  for (const annotation of annotations) await repository.save(annotation);
  const changeLog = new InMemoryChangeLogRepository();
  const editor = new EditorService(repository, {
    identity: new StaticIdentityProvider(person(role)),
    policy: new CompositeEditPolicy([new SealedByExportPolicy(() => new Set(sealed)), new RoleEditPolicy()]),
    changeLog,
    ids: new CounterIdGenerator(),
  });
  return { repository, editor, changeLog };
}

check('a bulk status change is one undo step, and an issued task is skipped and named', async () => {
  const [a, b, c] = [pin('a', SHEET_1, 'One'), pin('b', SHEET_1, 'Two'), pin('c', SHEET_1, 'Three')];
  const { repository, editor, changeLog } = await editorWith([a, b, c], { sealed: ['c'] });

  const result = await editor.applyAll(
    [a, b, c].map((previous) => ({ previous, next: previous.withStatus(PinStatus.CLOSED) })),
    'Close',
  );
  assert.deepEqual(result.applied.map((annotation) => annotation.id), ['a', 'b']);
  assert.deepEqual(result.skipped.map(({ annotation }) => annotation.id), ['c']);
  assert.match(result.skipped[0].reason, /issued|permanent|read-only/i);

  const statuses = async () => (await repository.listBySheet(SHEET_1)).map((pinned) => `${pinned.id}:${pinned.status}`).sort();
  assert.deepEqual(await statuses(), ['a:closed', 'b:closed', 'c:open']);
  assert.equal(editor.peekUndo(), 'Close', 'the undo button names the whole step');
  assert.equal((await changeLog.listForAnnotation(SHEET_1, 'a')).length, 1, 'each task records its own change');

  await editor.undo();
  assert.deepEqual(await statuses(), ['a:open', 'b:open', 'c:open']);
  assert.equal(editor.canUndo(), false, 'one step undid all of it');
});

check('a collaborator cannot bulk-edit: every task is skipped, nothing is written', async () => {
  const a = pin('a', SHEET_1, 'One');
  const { repository, editor } = await editorWith([a], { role: 'collaborator' });
  const result = await editor.applyAll([{ previous: a, next: a.withStatus(PinStatus.CLOSED) }], 'Close');
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal((await repository.listBySheet(SHEET_1))[0].status, PinStatus.OPEN);
  assert.equal(editor.canUndo(), false);
});

check('placing a task on a sheet moves it there in one step, and undo puts it back off the sheet', async () => {
  const made = task('t1', 'Patch hole by door');
  const { repository, editor } = await editorWith([made]);
  const placed = made.placedAt(SHEET_2, new PdfPoint(72, 72));

  const result = await editor.applyAll([{ previous: made, next: placed }], 'Place on sheet');
  assert.equal(result.applied.length, 1);
  assert.deepEqual((await repository.listBySheet(TASKS)).map((x) => x.id), []);
  assert.deepEqual((await repository.listBySheet(SHEET_2)).map((x) => [x.id, x.getKind()]), [['t1', 'pin']]);

  await editor.undo();
  assert.deepEqual((await repository.listBySheet(TASKS)).map((x) => [x.id, x.getKind()]), [['t1', 'task']]);
  assert.deepEqual(await repository.listBySheet(SHEET_2), []);
});

check('a bulk delete and a create go through the same step', async () => {
  const [a, b] = [pin('a', SHEET_1, 'One'), pin('b', SHEET_1, 'Two')];
  const { repository, editor } = await editorWith([a, b]);
  await editor.applyAll([{ previous: a, next: null }, { previous: null, next: task('t9', 'New one') }], 'Tidy up');
  assert.deepEqual((await repository.listBySheet(SHEET_1)).map((x) => x.id), ['b']);
  assert.deepEqual((await repository.listBySheet(TASKS)).map((x) => x.id), ['t9']);
  await editor.undo();
  assert.deepEqual((await repository.listBySheet(SHEET_1)).map((x) => x.id).sort(), ['a', 'b']);
  assert.deepEqual(await repository.listBySheet(TASKS), []);
});

check('a new task with no description is refused, not stored', async () => {
  const { repository, editor } = await editorWith([]);
  const result = await editor.applyAll([{ previous: null, next: task('t1', '   ') }], 'Add task');
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(await repository.listBySheet(TASKS), []);
});

// =========================================================================
// 4b. READING THE PROJECT
// =========================================================================

check('the HTTP adapter reads the project locks, the latest changes and an item history', async () => {
  const requests = [];
  const actor = { id: '3', displayName: 'Pat Power', company: 'Apex Electrical', role: 'power_collaborator' };
  const change = (id, annotationId, sheetId) => ({ id, annotationId, sheetId, intent: 'update', actor, at: '2026-11-09T10:00:00Z', detail: 'Close' });
  const fake = async (url) => {
    const path = new URL(url, 'http://localhost').pathname;
    requests.push(path);
    const body = path.endsWith('/sealed')
      ? ['p2']
      : path.endsWith('/changes/latest')
        ? { t1: change('c1', 't1', TASKS) }
        : [change('c2', 'task 1', SHEET_1), change('c1', 'task 1', TASKS)];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const repo = new HttpTaskRepository('/api', fake);

  assert.deepEqual([...(await repo.sealedIds(7))], ['p2']);
  const latest = await repo.latestChanges(7);
  assert.equal(String(latest.get('t1').actor), 'Pat Power (Apex Electrical)');
  const history = await repo.historyFor('task 1');
  assert.deepEqual(history.map((record) => record.sheetId), [SHEET_1, TASKS]);
  assert.deepEqual(requests, ['/api/projects/7/sealed', '/api/projects/7/changes/latest', '/api/annotations/task%201/changes']);
});

// =========================================================================
// 5. CSV
// =========================================================================

check('the CSV has a byte-order mark, the agreed columns, and one line per task', () => {
  const csv = taskCsv(sortTaskRows(rowsOf(project()), 'sheet'));
  assert.ok(csv.startsWith('﻿'), 'Excel reads UTF-8 only with a byte-order mark');
  const [header, ...lines] = csv.slice(1).split('\r\n');
  assert.equal(
    header,
    'Number,Drawing,Sheet,Description,Status,Priority,Trade,Company,Assigned to,Due date,Overdue,Created,Last updated by,Last updated at',
  );
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^2,A\.pdf,A-101,Ceiling tile stained,Open,Medium,,Metro Drywall,Casey Collab,2026-11-01,Yes,2026-11-01,,$/);
  assert.match(lines[3], /^G-1,,Not on a sheet,Order tiles,Ready for review,High,/);
});

check('commas, quotes, new lines and accents survive; formula-like text is defused', () => {
  const tricky = rowsOf([
    pin('x', SHEET_1, 'Seal gap, "north" side\nthen paint — café'),
    pin('y', SHEET_1, '=HYPERLINK("http://example.test")'),
  ]);
  const csv = taskCsv(tricky);
  assert.ok(csv.includes('"Seal gap, ""north"" side\nthen paint — café"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://example.test"")"`));
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

console.log(`\n${checks.length - failed}/${checks.length} tasks tab checks passed.`);
process.exit(failed === 0 ? 0 : 1);
