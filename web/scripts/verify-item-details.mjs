/**
 * Checks punch item details — trade, responsible company, assignee, due date —
 * and the registry that makes adding the next one a new file.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. NOTHING ALREADY STORED BREAKS. Every pin saved before details existed
 *    must load, and a pin with no details must store exactly what it stored
 *    before. Users have weeks of markups in their browsers.
 *
 * 2. DETAILS ARE NEVER SILENTLY LOST. Moving a pin, changing its status or its
 *    description all rebuild it; each copy must carry the details along. And a
 *    value written by a NEWER build, under a field this build does not know,
 *    must survive being edited here.
 *
 * 3. DUE DATES DO NOT SHIFT A DAY. '2026-10-10' must be the 10th everywhere,
 *    never the 9th because something treated it as UTC midnight.
 *
 * 4. A NEW FIELD IS A NEW FILE. The last group registers a field this suite
 *    invents and shows it is stored, cleaned and round-tripped with no change
 *    to Pin or to anything else.
 *
 * Run with: npm run verify:details
 */
import assert from 'node:assert/strict';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import '../src/domain/rules/index.js';
import { AnnotationRegistry } from '../src/domain/annotations/AnnotationRegistry.js';
import {
  AssigneeField,
  CalendarDate,
  DueDateField,
  ItemField,
  ItemFieldRegistry,
  ResponsibleCompanyField,
  TextItemField,
  TradeField,
} from '../src/domain/details/index.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { CounterIdGenerator } from '../src/domain/identity/CounterIdGenerator.js';
import {
  ActiveSeals,
  CompositeEditPolicy,
  EditNotPermittedError,
  SealedByExportPolicy,
} from '../src/domain/policy/index.js';
import { EditorService } from '../src/domain/services/EditorService.js';
import { InMemoryAnnotationRepository } from '../src/infrastructure/persistence/InMemoryAnnotationRepository.js';
import { InMemoryChangeLogRepository } from '../src/infrastructure/persistence/InMemoryChangeLogRepository.js';

const SHEET = 'drawing.pdf#0';
const TRADE = TradeField.KEY;
const COMPANY = ResponsibleCompanyField.KEY;
const ASSIGNEE = AssigneeField.KEY;
const DUE = DueDateField.KEY;

function pin(id = 'p1', label = 'Cracked tile at column B4') {
  return new Pin(id, SHEET, new PdfPoint(100, 200), label, PinStatus.OPEN, new Date('2026-10-01T12:00:00Z'));
}

/** Store and reload, exactly as localStorage and the Go API would. */
function roundTrip(annotation) {
  return AnnotationRegistry.fromJSON(JSON.parse(JSON.stringify(annotation.toJSON())));
}

function build({ sealed = [] } = {}) {
  const repository = new InMemoryAnnotationRepository();
  const changeLog = new InMemoryChangeLogRepository();
  const activeSeals = new ActiveSeals();
  activeSeals.add(sealed);

  const editor = new EditorService(repository, {
    changeLog,
    ids: new CounterIdGenerator(),
    policy: new CompositeEditPolicy([new SealedByExportPolicy(() => activeSeals.ids)]),
  });

  return { repository, changeLog, editor };
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// PART 1 — nothing already stored breaks
// =========================================================================

check('a pin saved before details existed loads, with no details', () => {
  const legacy = {
    id: 'old',
    sheetId: SHEET,
    kind: 'pin',
    createdAt: '2026-09-07T10:00:00.000Z',
    x: 50,
    y: 60,
    payload: { label: 'Paint scuff', status: 'open' },
  };

  const loaded = AnnotationRegistry.fromJSON(legacy);
  assert.ok(loaded instanceof Pin);
  assert.equal(loaded.details.isEmpty(), true);
  assert.equal(loaded.details.get(TRADE), '');
});

check('a pin with no details stores exactly what it stored before', () => {
  assert.deepEqual(pin().toJSON().payload, { label: 'Cracked tile at column B4', status: 'open' });
});

check('details that are not an object are treated as none, not a crash', () => {
  for (const junk of [null, 'Electrical', 42, ['Electrical'], true]) {
    const dto = { ...pin().toJSON(), payload: { label: 'x', status: 'open', details: junk } };
    assert.equal(AnnotationRegistry.fromJSON(dto).details.isEmpty(), true, JSON.stringify(junk));
  }
});

check('an unusable stored value is dropped; the rest of the pin still loads', () => {
  const dto = {
    ...pin().toJSON(),
    payload: {
      label: 'x',
      status: 'open',
      details: { [TRADE]: 'Drywall', [DUE]: '2026-02-30', [COMPANY]: { name: 'object' } },
    },
  };

  const loaded = AnnotationRegistry.fromJSON(dto);
  assert.equal(loaded.details.get(TRADE), 'Drywall');
  assert.equal(loaded.details.get(DUE), '', 'February has no 30th');
  assert.equal(loaded.details.get(COMPANY), '', 'an object is not a company name');
});

// =========================================================================
// PART 2 — details are never silently lost
// =========================================================================

check('setting a detail returns a new pin and leaves the original untouched', () => {
  const original = pin();
  const assigned = original.withDetail(TRADE, 'Electrical');

  assert.notEqual(assigned, original);
  assert.equal(assigned.details.get(TRADE), 'Electrical');
  assert.equal(original.details.get(TRADE), '');
  assert.equal(assigned.id, original.id);
  assert.equal(assigned.label, original.label);
  assert.equal(assigned.status, original.status);
  assert.ok(assigned.position.equals?.(original.position) ?? assigned.position === original.position);
});

check('moving, re-describing and changing status all keep the details', () => {
  const assigned = pin()
    .withDetail(TRADE, 'HVAC')
    .withDetail(COMPANY, 'Keystone Mechanical')
    .withDetail(DUE, '2026-10-10');

  for (const [what, copy] of [
    ['movedBy', assigned.movedBy(10, -5)],
    ['movedTo', assigned.movedTo(new PdfPoint(1, 2))],
    ['withLabel', assigned.withLabel('Duct not sealed')],
    ['withStatus', assigned.withStatus(PinStatus.CLOSED)],
  ]) {
    assert.ok(copy.details.equals(assigned.details), `${what} dropped the details`);
  }
});

check('details survive a save and reload', () => {
  const assigned = pin()
    .withDetail(TRADE, 'Plumbing')
    .withDetail(COMPANY, 'Bay Plumbing Co.')
    .withDetail(ASSIGNEE, 'R. Alvarez')
    .withDetail(DUE, '2026-11-03');

  const reloaded = roundTrip(assigned);
  assert.deepEqual(reloaded.details.toJSON(), assigned.details.toJSON());
});

check('a field from a NEWER build survives an edit made by this one', () => {
  const fromNewerBuild = {
    ...pin().toJSON(),
    payload: { label: 'x', status: 'open', details: { [TRADE]: 'Tile', priority: 'high', costUsd: 450 } },
  };

  const edited = AnnotationRegistry.fromJSON(fromNewerBuild).withDetail(TRADE, 'Flooring');
  const stored = roundTrip(edited).details.toJSON();

  assert.equal(stored[TRADE], 'Flooring');
  assert.equal(stored.priority, 'high', 'an unknown field must not be deleted');
  assert.equal(stored.costUsd, 450);
});

check('clearing a field removes it; clearing the last one stores no details at all', () => {
  const assigned = pin().withDetail(TRADE, 'Glazing');
  const cleared = assigned.withDetail(TRADE, '   ');

  assert.equal(cleared.details.get(TRADE), '');
  assert.equal(cleared.details.isEmpty(), true);
  assert.equal('details' in cleared.toJSON().payload, false);
});

check('an edit that changes nothing returns the SAME pin', () => {
  const assigned = pin().withDetail(COMPANY, 'Rivera Electric');

  assert.equal(assigned.withDetail(COMPANY, 'Rivera Electric'), assigned);
  assert.equal(assigned.withDetail(COMPANY, '  Rivera   Electric '), assigned, 'same after cleaning');

  const blank = pin();
  assert.equal(blank.withDetail(TRADE, ''), blank, 'clearing a field that is not set changes nothing');
});

check('an unregistered key or an invalid value is refused, not stored or cleared', () => {
  const assigned = pin().withDetail(DUE, '2026-10-10');

  assert.throws(() => assigned.withDetail('nonsense', 'x'), RangeError);
  assert.throws(() => assigned.withDetail(DUE, '2026-13-01'), RangeError);
  assert.throws(() => assigned.withDetail(DUE, 'next friday'), RangeError);
  assert.equal(assigned.details.get(DUE), '2026-10-10', 'a refused edit must not clear the date');
});

// =========================================================================
// PART 3 — text is stored one way
// =========================================================================

check('company names are trimmed and their spacing normalized', () => {
  const company = new ResponsibleCompanyField();

  // Escapes, because the characters themselves are invisible: a non-breaking
  // space, a tab, a pasted line break, and a zero-width space from a web page.
  assert.equal(company.normalize('  Rivera\u00a0 Electric\t'), 'Rivera Electric');
  assert.equal(company.normalize('Rivera\nElectric'), 'Rivera Electric');
  assert.equal(company.normalize('Rivera\u200bElectric'), 'RiveraElectric');
  assert.equal(company.normalize('Bell\u0007 Glass'), 'Bell Glass');
  assert.equal(company.normalize(42), '');
  assert.equal(company.normalize(null), '');
});

check('normalizing is idempotent, so re-reading storage never changes a value', () => {
  const field = new TradeField();
  for (const raw of ['  Fire   protection ', 'Doors & hardware', 'Électricité', '']) {
    const once = field.normalize(raw);
    assert.equal(field.normalize(once), once);
  }
});

check('long text is capped by characters, never cutting an emoji in half', () => {
  const field = new AssigneeField();
  const limit = field.getMaxLength();
  const long = '👷'.repeat(limit + 10);

  const stored = field.normalize(long);
  assert.equal(Array.from(stored).length, limit);
  assert.ok(!/[\ud800-\udbff]$/.test(stored), 'must not end on half a surrogate pair');
});

// =========================================================================
// PART 4 — due dates are calendar days, not instants
// =========================================================================

check('a due date is the same day in every time zone', () => {
  const date = CalendarDate.parse('2026-10-10');
  const local = date.toLocalDate();

  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getMonth(), 9);
  assert.equal(local.getDate(), 10, 'must not shift to the 9th the way new Date("2026-10-10") does west of UTC');
  assert.equal(new DueDateField().format('2026-10-10'), '10 Oct 2026');
});

check('only real calendar days are accepted', () => {
  const valid = ['2026-10-10', '2028-02-29', '1900-01-01', '2999-12-31'];
  const invalid = [
    '2027-02-29', // not a leap year
    '2026-04-31',
    '2026-00-10',
    '2026-1-5', // not zero-padded — not what a date input produces
    '0026-10-10', // a mistyped year
    '20266-10-10',
    '2026-10-10T00:00:00Z', // an instant, not a day
    'Oct 10 2026',
  ];

  for (const value of valid) assert.ok(CalendarDate.parse(value), `${value} should parse`);
  for (const value of invalid) assert.equal(CalendarDate.parse(value), null, `${value} should not parse`);
});

check('the due date field explains a bad date and allows an empty one', () => {
  const field = new DueDateField();

  assert.equal(field.validate(''), null);
  assert.equal(field.validate('  '), null);
  assert.equal(field.validate(undefined), null);
  assert.equal(field.validate('2026-10-10'), null);
  assert.match(field.validate('2026-02-30'), /real date/);
});

check('past due dates are allowed, and days compare in calendar order', () => {
  const earlier = CalendarDate.parse('2026-09-30');
  const later = CalendarDate.parse('2026-10-01');

  assert.equal(pin().withDetail(DUE, '2025-01-15').details.get(DUE), '2025-01-15');
  assert.ok(earlier.isBefore(later));
  assert.equal(later.isBefore(earlier), false);
  assert.ok(earlier.equals(CalendarDate.parse('2026-09-30')));
  assert.equal(CalendarDate.fromLocalDate(new Date(2026, 9, 10, 23, 59)).toString(), '2026-10-10');
});

// =========================================================================
// PART 5 — edits go through the editor like every other change
// =========================================================================

check('a detail edit is saved, undoable, redoable and named in the history', async () => {
  const { editor, repository, changeLog } = build();
  const original = pin();
  await editor.add(original);

  const assigned = original.withDetail(COMPANY, 'Rivera Electric');
  const label = new ResponsibleCompanyField().describeChange('Rivera Electric');
  await editor.update(original, assigned, label);

  let [stored] = await repository.listBySheet(SHEET);
  assert.equal(stored.details.get(COMPANY), 'Rivera Electric');
  assert.equal(editor.peekUndo(), 'Set responsible company of pin');

  const [latest] = await changeLog.listForAnnotation(SHEET, original.id);
  assert.equal(latest.detail, 'Set responsible company of');

  await editor.undo();
  [stored] = await repository.listBySheet(SHEET);
  assert.equal(stored.details.get(COMPANY), '');

  await editor.redo();
  [stored] = await repository.listBySheet(SHEET);
  assert.equal(stored.details.get(COMPANY), 'Rivera Electric');
});

check('the assignee words its own change', () => {
  assert.equal(new AssigneeField().describeChange('R. Alvarez'), 'Assign');
  assert.equal(new AssigneeField().describeChange(''), 'Unassign');
  assert.equal(new DueDateField().describeChange(''), 'Clear due date of');
});

check('an ISSUED pin\'s details cannot be changed', async () => {
  const original = pin('sealed');
  const { editor } = build({ sealed: [original.id] });

  await assert.rejects(
    () => editor.update(original, original.withDetail(TRADE, 'Drywall'), 'Set trade of'),
    EditNotPermittedError,
  );
});

// =========================================================================
// PART 6 — the next field is a new file
// =========================================================================

check('the four fields are registered, in display order', () => {
  assert.deepEqual(
    ItemFieldRegistry.all().map((field) => field.getKey()),
    [TRADE, COMPANY, ASSIGNEE, DUE],
  );
});

check('a field missing part of the contract is refused when built', () => {
  class Unfinished extends ItemField {
    getKey() {
      return 'unfinished';
    }
  }
  assert.throws(() => new Unfinished(), /does not override: getLabel, getInputKind, normalize/);
  assert.throws(() => new TextItemField(), /does not override: getKey, getLabel/);
});

check('a badly named key, a non-field, and a duplicate are all refused', () => {
  class BadKey extends TextItemField {
    getKey() {
      return 'Room Number';
    }
    getLabel() {
      return 'Room';
    }
  }
  assert.throws(() => ItemFieldRegistry.register(new BadKey()), /camelCase/);
  assert.throws(() => ItemFieldRegistry.register({ getKey: () => 'room' }), TypeError);
  assert.throws(() => ItemFieldRegistry.register(new TradeField()), /already registered/);
});

check('A NEW FIELD IS A NEW FILE: registered, it is stored and cleaned with no other change', () => {
  // Everything below is what a teammate would write in fields/RoomField.js —
  // and nothing else in the application is touched.
  class RoomField extends TextItemField {
    getKey() {
      return 'room';
    }
    getLabel() {
      return 'Room';
    }
    getMaxLength() {
      return 12;
    }
  }
  ItemFieldRegistry.register(new RoomField());

  const placed = pin().withDetail('room', '  Conference   101 ');
  assert.equal(placed.details.get('room'), 'Conference 1', 'cleaned and capped by its own rules');
  assert.equal(roundTrip(placed).details.get('room'), 'Conference 1');
  assert.equal(ItemFieldRegistry.all().at(-1).getKey(), 'room', 'appears after the shipped fields');
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

console.log(`\n${checks.length - failed}/${checks.length} item detail checks passed.`);
process.exit(failed === 0 ? 0 : 1);
