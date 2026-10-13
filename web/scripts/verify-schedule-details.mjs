/**
 * Checks that the issued punch list schedule shows each item's trade,
 * responsible company, assignee and due date.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. THE DETAILS ARE IN THE FILE. Read back out of a real flattened export,
 *    not asserted against the layout code — the question is what the person
 *    holding the printout can read.
 * 2. A ROW IS NEVER SPLIT. A row grew a second line; pagination has to know,
 *    or an item's due date would print at the top of the next page, under
 *    somebody else's description.
 * 3. A NEW FIELD REACHES THE SCHEDULE WITH NO EDIT to the writer or the
 *    schedule builder.
 *
 * Run with: npm run verify -- schedule-details
 */
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import '../src/domain/rules/index.js';
import {
  AssigneeField,
  DueDateField,
  ItemDetails,
  ItemFieldRegistry,
  ResponsibleCompanyField,
  TextItemField,
  TradeField,
} from '../src/domain/details/index.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { PunchListEntry, PunchListRegistry } from '../src/domain/punchlist/index.js';
import { FlattenedSheetExporter } from '../src/infrastructure/export/FlattenedSheetExporter.js';

const SHEET = 'drawing.pdf#0';

function pin(id, label, details = {}, status = PinStatus.OPEN) {
  let made = new Pin(id, SHEET, new PdfPoint(300, 400), label, status, new Date('2026-10-01T12:00:00Z'));
  for (const [key, value] of Object.entries(details)) made = made.withDetail(key, value);
  return made;
}

async function blankSheet(size = [612, 792]) {
  const doc = await PDFDocument.create();
  doc.addPage(size);
  return doc.save();
}

async function issue(annotations, size) {
  const { bytes } = await new FlattenedSheetExporter().exportAnnotated({
    sourceBytes: await blankSheet(size),
    pages: [{ pageIndex: 0, annotations }],
    author: 'Verifier',
    documentName: 'drawing.pdf',
  });
  return bytes;
}

/** A content stream's text, inflated when compressed. */
function decodeStream(stream) {
  const raw = stream?.getContents?.();
  if (!raw) return '';
  const bytes = Buffer.from(raw);
  try {
    return inflateSync(bytes).toString('latin1');
  } catch {
    return bytes.toString('latin1');
  }
}

/** The text drawn on each page, one string per page — `Tj` operands only. */
async function textByPage(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.get(PDFName.of('Contents'));
    const resolved = doc.context.lookup(contents);
    const streams = resolved instanceof PDFArray
      ? Array.from({ length: resolved.size() }, (_, i) => doc.context.lookup(resolved.get(i)))
      : [resolved];

    const found = [];
    for (const text of streams.map(decodeStream)) {
      for (const match of text.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
        found.push(match[1].replace(/\\([()\\])/g, '$1'));
      }
      for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
        found.push(Buffer.from(match[1].replace(/\s+/g, ''), 'hex').toString('latin1'));
      }
    }
    return found.join('\n');
  });
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// PART 1 — the details reach the printout
// =========================================================================

check('the issued schedule prints trade, company, assignee and due date, labelled', async () => {
  const bytes = await issue([
    pin('a', 'Outlet cover missing in corridor', {
      [TradeField.KEY]: 'Electrical',
      [ResponsibleCompanyField.KEY]: 'Rivera Electric',
      [AssigneeField.KEY]: 'R. Alvarez',
      [DueDateField.KEY]: '2026-10-10',
    }),
  ]);

  // Line breaks flattened to spaces: the details line wraps wherever the
  // column runs out, which is exactly what it should do.
  const schedule = (await textByPage(bytes)).at(-1).replace(/\s+/g, ' ');
  assert.match(schedule, /Trade: Electrical/);
  assert.match(schedule, /Responsible company: Rivera Electric/);
  assert.match(schedule, /Assigned to: R\. Alvarez/);
  assert.match(schedule, /Due date: 10 Oct 2026/, 'a date reads the same in Baltimore and in London');
});

check('only what was recorded is printed — no "Trade:" with nothing after it', async () => {
  const bytes = await issue([pin('a', 'Door binds on frame', { [DueDateField.KEY]: '2026-11-01' })]);
  const schedule = (await textByPage(bytes)).at(-1);

  assert.match(schedule, /Due date: 1 Nov 2026/);
  assert.doesNotMatch(schedule, /Trade:|Responsible company:|Assigned to:/);
});

check('an item with no details at all prints exactly as before — no empty second line', async () => {
  const entry = PunchListRegistry.collect([{ pageIndex: 0, annotations: [pin('a', 'Paint scuff')] }])[0];
  assert.deepEqual(entry.details, []);
  assert.equal(entry.detailsForPrint, '');

  const schedule = (await textByPage(await issue([pin('a', 'Paint scuff')]))).at(-1);
  assert.match(schedule, /Paint scuff/);
  assert.doesNotMatch(schedule, /:\s/, 'no labelled detail anywhere on the row');
});

check('a company name with accents and typographic quotes does not fail the export', async () => {
  const bytes = await issue([
    pin('a', 'Tile lippage', { [ResponsibleCompanyField.KEY]: 'Électricité “Nord” — Montréal' }),
  ]);
  assert.match((await textByPage(bytes)).at(-1), /Responsible company: /);
});

// =========================================================================
// PART 2 — rows are never split across pages
// =========================================================================

check('every item\'s details print on the SAME page as its description', async () => {
  const items = Array.from({ length: 45 }, (_, i) =>
    pin(`p${i}`, `Item ${i} description that is long enough to wrap onto a second line on the schedule`, {
      [TradeField.KEY]: `Trade${i}`,
      [ResponsibleCompanyField.KEY]: 'Mid-Atlantic Mechanical & Fire Protection, Inc.',
      [AssigneeField.KEY]: 'Someone With A Rather Long Name',
      [DueDateField.KEY]: '2026-12-31',
    }),
  );

  const pages = await textByPage(await issue(items));
  const schedule = pages.slice(1);
  assert.ok(schedule.length > 1, 'enough items to need several schedule pages');

  for (let i = 0; i < items.length; i++) {
    const page = schedule.find((text) => text.includes(`Item ${i} description`));
    assert.ok(page, `item ${i} is on the schedule`);
    assert.ok(page.includes(`Trade: Trade${i}`), `item ${i}'s details are on the same page as its description`);
  }
});

check('rows fit on a large sheet too, where type is scaled up', async () => {
  const items = Array.from({ length: 12 }, (_, i) =>
    pin(`p${i}`, `Item ${i}`, { [TradeField.KEY]: `T${i}`, [DueDateField.KEY]: '2026-12-31' }),
  );
  const pages = await textByPage(await issue(items, [2592, 1728]));

  for (let i = 0; i < items.length; i++) {
    const page = pages.find((text) => text.includes(`Item ${i}\n`) || text.endsWith(`Item ${i}`));
    assert.ok(page?.includes(`Trade: T${i}`), `item ${i} on ARCH D`);
  }
});

// =========================================================================
// PART 3 — the schedule names no field
// =========================================================================

check('details come out in field order, formatted, unknown keys left out', () => {
  const details = ItemDetails.fromJSON({
    [DueDateField.KEY]: '2026-10-10',
    priority: 'high',
    [TradeField.KEY]: 'Glazing',
  });

  assert.deepEqual(details.labelled(), [
    { key: TradeField.KEY, label: 'Trade', value: 'Glazing' },
    { key: DueDateField.KEY, label: 'Due date', value: '10 Oct 2026' },
  ]);
});

check('a schedule entry ignores malformed details rather than printing "undefined"', () => {
  const entry = new PunchListEntry({
    number: 1,
    pageIndex: 0,
    description: 'x',
    status: 'Open',
    createdAt: new Date(),
    details: [null, { label: 'Trade' }, { label: '', value: 'x' }, { label: 'Due date', value: '10 Oct 2026' }],
  });
  assert.equal(entry.detailsForPrint, 'Due date: 10 Oct 2026');
});

check('A NEW FIELD REACHES THE SCHEDULE: registered, it prints with no other change', async () => {
  class RoomField extends TextItemField {
    getKey() {
      return 'room';
    }
    getLabel() {
      return 'Room';
    }
  }
  ItemFieldRegistry.register(new RoomField());

  const bytes = await issue([pin('a', 'Ceiling tile stained', { room: 'Conference 101', [TradeField.KEY]: 'Ceilings' })]);
  assert.match((await textByPage(bytes)).at(-1), /Trade: Ceilings.*Room: Conference 101/s);
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

console.log(`\n${checks.length - failed}/${checks.length} schedule detail checks passed.`);
process.exit(failed === 0 ? 0 : 1);
