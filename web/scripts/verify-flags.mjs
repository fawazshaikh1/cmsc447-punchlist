/**
 * Checks markup flags — today, "overdue" — and that the next flag is a new file.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. OVERDUE MEANS WHAT A SITE MEANS BY IT. Late only once the due day has
 *    passed, only while the work is open, never once closed.
 * 2. "TODAY" IS A CALENDAR DAY. The check passes a date in, so it does not
 *    depend on what day or time zone it is run in.
 * 3. A NEW FLAG IS A NEW FILE, and one broken flag cannot hide the others.
 *
 * Run with: npm run verify -- flags
 */
import assert from 'node:assert/strict';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import { MarkupStyle } from '../src/domain/annotations/MarkupStyle.js';
import { RectangleMarkup } from '../src/domain/annotations/RectangleMarkup.js';
import { CalendarDate, DueDateField } from '../src/domain/details/index.js';
import { MarkupFlag, MarkupFlagRegistry, OverdueFlag } from '../src/domain/flags/index.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';

const SHEET = 'drawing.pdf#0';
const TODAY = { today: CalendarDate.parse('2026-10-08') };

function pin(dueDate, status = PinStatus.OPEN) {
  let made = new Pin('p1', SHEET, new PdfPoint(10, 20), 'Cracked tile', status, new Date('2026-10-01T12:00:00Z'));
  if (dueDate) made = made.withDetail(DueDateField.KEY, dueDate);
  return made;
}

const overdue = new OverdueFlag();
const ids = (annotation, context = TODAY) =>
  MarkupFlagRegistry.flagsFor(annotation, context).map((flag) => flag.getId());

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// PART 1 — what counts as overdue
// =========================================================================

check('an open item due yesterday is overdue', () => {
  assert.deepEqual(ids(pin('2026-10-07')), ['overdue']);
});

check('due TODAY is not late yet — the trade has the whole day', () => {
  assert.deepEqual(ids(pin('2026-10-08')), []);
});

check('due in the future is not overdue', () => {
  assert.deepEqual(ids(pin('2026-12-01')), []);
});

check('a closed item is never overdue', () => {
  assert.deepEqual(ids(pin('2026-01-01', PinStatus.CLOSED)), []);
});

check('ready for review is not overdue — the trade says the work is done', () => {
  assert.deepEqual(ids(pin('2026-01-01', PinStatus.READY_FOR_REVIEW)), []);
});

check('an item with no due date is never overdue', () => {
  assert.deepEqual(ids(pin(null)), []);
});

check('a markup with no due date field at all — a box — is never overdue', () => {
  const box = new RectangleMarkup(
    'b1',
    SHEET,
    new PdfPoint(0, 0),
    new PdfPoint(50, 50),
    new MarkupStyle(),
    new Date('2026-10-01T12:00:00Z'),
  );
  assert.deepEqual(ids(box), []);
});

check('a missing "today" or a junk markup is treated as not overdue, not a crash', () => {
  assert.equal(overdue.appliesTo(pin('2026-10-01'), {}), false);
  assert.equal(overdue.appliesTo(null, TODAY), false);
  assert.equal(overdue.appliesTo({ status: 'open', details: 'nonsense' }, TODAY), false);
});

// =========================================================================
// PART 2 — what the user is told
// =========================================================================

check('the panel sentence names the due date and how late it is', () => {
  assert.equal(overdue.describe(pin('2026-10-07'), TODAY), 'Overdue — was due 7 Oct 2026, yesterday.');
  assert.equal(overdue.describe(pin('2026-10-03'), TODAY), 'Overdue — was due 3 Oct 2026, 5 days ago.');
});

check('days late counts calendar days across a daylight-saving change', () => {
  // US clocks go back on 1 Nov 2026; a naive millisecond division would be off.
  const context = { today: CalendarDate.parse('2026-11-03') };
  assert.match(overdue.describe(pin('2026-10-31'), context), /3 days ago/);
});

check('overdue is drawn in the most serious tone', () => {
  assert.equal(MarkupFlagRegistry.strongestTone(MarkupFlagRegistry.flagsFor(pin('2026-10-01'), TODAY)), 'danger');
  assert.equal(MarkupFlagRegistry.strongestTone([]), null);
});

// =========================================================================
// PART 3 — the next flag is a new file
// =========================================================================

check('a flag missing part of the contract, a bad id, or a bad tone is refused', () => {
  class Unfinished extends MarkupFlag {
    getId() {
      return 'unfinished';
    }
  }
  assert.throws(() => new Unfinished(), /does not override: getTone, appliesTo, describe/);

  class BadId extends MarkupFlag {
    getId() {
      return 'Due Soon';
    }
    getTone() {
      return 'warning';
    }
    appliesTo() {
      return false;
    }
    describe() {
      return '';
    }
  }
  assert.throws(() => MarkupFlagRegistry.register(new BadId()), /lowercase and hyphenated/);

  class Shouting extends BadId {
    getId() {
      return 'shouting';
    }
    getTone() {
      return 'red';
    }
  }
  assert.throws(() => MarkupFlagRegistry.register(new Shouting()), /must be one of/);
  assert.throws(() => MarkupFlagRegistry.register(new OverdueFlag()), /already registered/);
});

check('A NEW FLAG IS A NEW FILE: registered, it applies alongside overdue with no other change', () => {
  // What a teammate would write in domain/flags/UnassignedFlag.js.
  class UnassignedFlag extends MarkupFlag {
    getId() {
      return 'unassigned';
    }
    getTone() {
      return 'warning';
    }
    appliesTo(annotation) {
      return typeof annotation?.details?.get === 'function' && !annotation.details.get('responsibleCompany');
    }
    describe() {
      return 'Nobody is responsible for this yet.';
    }
  }
  MarkupFlagRegistry.register(new UnassignedFlag());

  const late = pin('2026-10-01');
  assert.deepEqual(ids(late), ['overdue', 'unassigned'], 'listed in registration order');
  assert.equal(MarkupFlagRegistry.strongestTone(MarkupFlagRegistry.flagsFor(late, TODAY)), 'danger', 'the most serious wins');
  assert.deepEqual(ids(pin(null)), ['unassigned']);
});

check('one flag that throws does not hide the others or break the sheet', () => {
  class Broken extends MarkupFlag {
    getId() {
      return 'broken';
    }
    getTone() {
      return 'info';
    }
    appliesTo() {
      throw new Error('boom');
    }
    describe() {
      return '';
    }
  }
  MarkupFlagRegistry.register(new Broken());

  const original = console.warn;
  console.warn = () => {};
  try {
    assert.ok(ids(pin('2026-10-01')).includes('overdue'));
  } finally {
    console.warn = original;
  }
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

console.log(`\n${checks.length - failed}/${checks.length} flag checks passed.`);
process.exit(failed === 0 ? 0 : 1);
