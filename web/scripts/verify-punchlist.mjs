/**
 * Checks that an issued PDF says what its pins are for.
 *
 * ===========================================================================
 * THE BUG THIS PINS DOWN
 * ===========================================================================
 * A pin's description lived only in the annotation's `/Contents`. Flattening
 * removes the annotation — that is the entire point of flattening — so the
 * issued PDF showed a red circle with a number in it and nothing anywhere to
 * say what the number meant.
 *
 * Reported as: "in the flat, i cannot see what the pin is for, i can't see the
 * description and stuff".
 *
 * The fix is a schedule appended to the document, keyed by the number drawn
 * inside the pin. So there are two things to hold down, and the second is the
 * one that would rot quietly:
 *
 *   1. the description reaches the file at all
 *   2. the number on the schedule is the number on the drawing
 *
 * ---------------------------------------------------------------------------
 * A SECOND BUG, FOUND WHILE FIXING THE FIRST
 * ---------------------------------------------------------------------------
 * Pins were numbered by their position in the sheet's annotation list, which
 * holds every markup regardless of type. A pin drawn after two boxes exported
 * as "Punch item 3". Delete a box and the same item silently becomes 2 — on a
 * document somebody has already printed. Several checks below are about that.
 *
 *     npm run verify:punchlist
 */
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import { RectangleMarkup } from '../src/domain/annotations/RectangleMarkup.js';
import { MarkupStyle } from '../src/domain/annotations/MarkupStyle.js';
import '../src/domain/annotations/index.js';
import '../src/domain/rules/index.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { PunchListRegistry, PunchListEntry, assignOrdinals } from '../src/domain/punchlist/index.js';
import { FlattenedSheetExporter } from '../src/infrastructure/export/FlattenedSheetExporter.js';
import { PunchListPageWriter } from '../src/infrastructure/export/PunchListPageWriter.js';

// --- fixtures ---------------------------------------------------------------

const SHEET = 'drawing.pdf#0';

function pin(id, label, status = PinStatus.OPEN, x = 300, y = 400) {
  return new Pin(id, SHEET, new PdfPoint(x, y), label, status, new Date('2026-09-24T12:00:00Z'));
}

function box(id) {
  return new RectangleMarkup(
    id,
    SHEET,
    new PdfPoint(100, 100),
    new PdfPoint(200, 200),
    new MarkupStyle(),
    new Date('2026-09-24T12:00:00Z'),
  );
}

async function blankSheet(size = [612, 792]) {
  const doc = await PDFDocument.create();
  doc.addPage(size);
  return doc.save();
}

/**
 * A content stream's operators as text, inflating it when it is compressed.
 *
 * pdf-lib Flate-compresses the streams it writes on save, so reading
 * `getContents()` directly yields deflate bytes and finds no operators at all.
 * That is not a visible failure — it is an empty string that every `assert.match`
 * below fails against, which reads exactly like the feature being broken.
 */
function decodeStream(stream) {
  const raw = stream?.getContents?.();
  if (!raw) return null;

  const bytes = Buffer.from(raw);
  try {
    return inflateSync(bytes).toString('latin1');
  } catch {
    // Not compressed — our own appended operators are written as plain text.
    return bytes.toString('latin1');
  }
}

/**
 * Every run of text in a PDF, as one string.
 *
 * Read back out of the produced file rather than asserted against the layout
 * code, because the question is whether the DESCRIPTION IS IN THE FILE. A check
 * against the layout would pass just as happily if `drawText` were never
 * reached.
 *
 * Not a general text extractor: it reads the operands of `Tj`, in both the
 * literal and hex forms, which is all this writer emits. Positioning, encoding
 * and reading order are all ignored, because the question here is only whether
 * the words reached the file.
 */
async function textIn(bytes) {
  const doc = await PDFDocument.load(bytes);
  const found = [];

  for (const page of doc.getPages()) {
    const contents = page.node.normalizedEntries?.().Contents ?? page.node.get(PDFName.of('Contents'));
    const resolved = doc.context.lookup(contents);
    const streams = resolved instanceof PDFArray
      ? Array.from({ length: resolved.size() }, (_, i) => doc.context.lookup(resolved.get(i)))
      : [resolved];

    for (const stream of streams) {
      const text = decodeStream(stream);
      if (!text) continue;

      // Literal strings — what our own hand-written operators emit.
      for (const match of text.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
        found.push(match[1].replace(/\\([()\\])/g, '$1'));
      }

      // Hex strings — what pdf-lib's `drawText` emits, because it encodes the
      // string through the font. Reading only the literal form found nothing at
      // all on these pages, which made every content assertion below fail
      // against an empty string rather than against the document.
      for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
        found.push(Buffer.from(match[1].replace(/\s+/g, ''), 'hex').toString('latin1'));
      }
    }
  }

  return found.join('\n');
}

async function pageCountOf(bytes) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// --- the checks -------------------------------------------------------------

check('THE REPORTED BUG: a description survives flattening', async () => {
  const exporter = new FlattenedSheetExporter();
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('a', 'Cracked tile at corridor entrance')] }],
    author: 'Verifier',
    documentName: 'drawing.pdf',
  });

  const text = await textIn(bytes);
  assert.match(text, /Cracked tile at corridor entrance/, 'the words are in the file');
  assert.match(text, /PUNCH LIST/);
  assert.equal(await pageCountOf(bytes), 2, 'the drawing, plus one schedule page');
});

check('the schedule number is the number drawn in the pin', async () => {
  // Two boxes FIRST, which is what broke the old numbering.
  const annotations = [box('b1'), box('b2'), pin('p1', 'First item'), pin('p2', 'Second item')];
  const ordinals = assignOrdinals([{ pageIndex: 0, annotations }]);

  assert.equal(ordinals.get(annotations[2]), 1, 'the first PIN is item 1, not item 3');
  assert.equal(ordinals.get(annotations[3]), 2);

  const entries = PunchListRegistry.collect([{ pageIndex: 0, annotations }], ordinals);
  assert.deepEqual(entries.map((e) => e.number), [1, 2]);
  assert.deepEqual(entries.map((e) => e.description), ['First item', 'Second item']);
});

check('numbering runs across sheets, not per sheet', async () => {
  const pages = [
    { pageIndex: 0, annotations: [pin('a', 'One'), pin('b', 'Two')] },
    { pageIndex: 1, annotations: [pin('c', 'Three')] },
  ];

  const entries = PunchListRegistry.collect(pages);

  // Per-sheet numbering would give two different items called "1", and every
  // reference to one of them would need the sheet to disambiguate it.
  assert.deepEqual(entries.map((e) => e.number), [1, 2, 3]);
  assert.deepEqual(entries.map((e) => e.sheetLabel), ['Sheet 1', 'Sheet 1', 'Sheet 2']);
});

check('only markups that are punch items are scheduled', async () => {
  const entries = PunchListRegistry.collect([
    { pageIndex: 0, annotations: [box('b1'), pin('p1', 'Real item'), box('b2')] },
  ]);

  // A box is emphasis, not something anyone has to act on. Listing every markup
  // would bury the items that matter.
  assert.equal(entries.length, 1);
  assert.equal(entries[0].description, 'Real item');
});

check('an item nobody wrote up still gets a row', async () => {
  const exporter = new FlattenedSheetExporter();
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('a', '')] }],
    author: 'Verifier',
  });

  // Silently dropping it would hide an item that IS on the drawing — the pin is
  // still drawn there. A blank row is the prompt to go and write it up.
  assert.match(await textIn(bytes), /\(no description\)/);
});

check('status reaches the schedule in words', async () => {
  const exporter = new FlattenedSheetExporter();
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [
      {
        pageIndex: 0,
        annotations: [
          pin('a', 'Still open'),
          pin('b', 'Awaiting sign-off', PinStatus.READY_FOR_REVIEW, 350, 450),
          pin('c', 'Done', PinStatus.CLOSED, 400, 500),
        ],
      },
    ],
    author: 'Verifier',
  });

  const text = await textIn(bytes);
  assert.match(text, /Open/);
  assert.match(text, /Ready for review/, 'not the stored ready_for_review');
  assert.match(text, /Closed/);
  assert.match(text, /3 items/);
  assert.match(text, /1 open/, 'the header counts what is outstanding');
});

check('a drawing with no pins gets no schedule page', async () => {
  const exporter = new FlattenedSheetExporter();
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [box('b1')] }],
    author: 'Verifier',
  });

  // An appended page reading "no items" is one more sheet to print and file.
  assert.equal(await pageCountOf(bytes), 1);
});

check('the schedule can be turned off without touching the exporter', async () => {
  const exporter = new FlattenedSheetExporter({ punchList: null });
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('a', 'Cracked tile')] }],
    author: 'Verifier',
  });

  assert.equal(await pageCountOf(bytes), 1, 'plan only');
});

check('a long list runs onto further schedule pages', async () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    pin(`p${i}`, `Item ${i + 1}: remedial work required to the satisfaction of the architect`),
  );

  const exporter = new FlattenedSheetExporter();
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: many }],
    author: 'Verifier',
  });

  const pageCount = await pageCountOf(bytes);
  assert.ok(pageCount > 2, `60 items should need more than one schedule page, got ${pageCount - 1}`);

  const text = await textIn(bytes);
  assert.match(text, /Item 1:/, 'the first item is present');
  assert.match(text, /Item 60:/, 'and so is the last');
  assert.match(text, /continued/, 'later pages say so');
});

check('the schedule prints on the same paper as the drawing', async () => {
  const ARCH_D = [2592, 1728];
  const exporter = new FlattenedSheetExporter();
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(ARCH_D),
    pages: [{ pageIndex: 0, annotations: [pin('a', 'Cracked tile')] }],
    author: 'Verifier',
  });

  const doc = await PDFDocument.load(bytes);
  const schedule = doc.getPage(1);
  assert.equal(Math.round(schedule.getWidth()), ARCH_D[0]);
  assert.equal(Math.round(schedule.getHeight()), ARCH_D[1]);
});

check('a description full of typographic characters does not fail the export', async () => {
  // Standard-font drawText THROWS outside WinAnsi. Descriptions are typed by
  // people and pasted from specifications, so this is not a theoretical case —
  // and the failure would take the whole export with it, not one row.
  const nasty = 'Replace “damaged” tile — see spec §3.2… ✅ 你好';

  const exporter = new FlattenedSheetExporter();
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('a', nasty)] }],
    author: 'Verifier',
  });

  const text = await textIn(bytes);
  assert.match(text, /Replace "damaged" tile - see spec/, 'quotes and dashes are folded, not dropped');
  assert.equal(await pageCountOf(bytes), 2);
});

check('a new markup type joins the schedule by registering, not by editing', async () => {
  // The open-closed claim, exercised rather than asserted. Nothing in
  // PunchListPageWriter or either exporter knows this kind exists.
  const KIND = 'verify-only-deficiency';
  assert.equal(PunchListRegistry.has(KIND), false);

  PunchListRegistry.register(KIND, (item, { number, pageIndex }) =>
    new PunchListEntry({
      number,
      pageIndex,
      description: item.note,
      status: 'Raised',
      createdAt: item.createdAt,
    }),
  );

  const fake = {
    note: 'Fire stopping missing above ceiling',
    createdAt: new Date('2026-09-24T12:00:00Z'),
    getKind: () => KIND,
  };

  const entries = PunchListRegistry.collect([{ pageIndex: 0, annotations: [fake] }]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].description, 'Fire stopping missing above ceiling');
  assert.equal(entries[0].status, 'Raised');

  // An unrecognised status token must not throw; it prints in the neutral ink.
  const writer = new PunchListPageWriter();
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  assert.equal(await writer.append(doc, entries), 1);
});

// --- runner -----------------------------------------------------------------

let failed = 0;

for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
}

console.log(
  failed === 0
    ? `\n${checks.length}/${checks.length} punch list checks passed.`
    : `\n${failed} of ${checks.length} punch list checks FAILED.`,
);

process.exit(failed === 0 ? 0 : 1);
