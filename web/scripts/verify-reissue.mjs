/**
 * Checks that a drawing which ALREADY carries markups can still be issued.
 *
 * ===========================================================================
 * THE BUG THIS PINS DOWN
 * ===========================================================================
 * Export a working copy, re-open it, press Issue — and the app said
 * "Nothing to export — no markups yet" about a sheet visibly covered in them.
 *
 * The cause was a counting mistake, not a drawing one. A sheet id is
 * `filename#pageIndex`, so re-opening `drawing-marked-up.pdf` looks up a sheet
 * nobody has ever drawn on. Our own count came back 0, and the gate in
 * `useExport` refused on that number alone — while the flattener underneath it
 * was perfectly capable of burning in the markups the FILE was carrying.
 *
 * So there were two populations of markup all along:
 *
 *   annotationCount   the ones WE are holding for this sheet: editable, ours
 *                     to seal
 *   flattenedCount    the ones actually burned into the page, which includes
 *                     every annotation the file arrived with
 *
 * They are equal on a first export, which is why this went unnoticed. They
 * diverge the moment a file is re-issued, and that is the case these checks
 * hold down.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SUITE USES A REAL PDF
 * ---------------------------------------------------------------------------
 * verify-sealing.mjs stubs the exporter, because sealing is a domain rule and
 * the bytes are irrelevant to it. Here the bytes ARE the subject: the question
 * is whether the flattener finds annotations it did not author, paints them,
 * and reports how many. A stub that returns `[1, 2, 3]` cannot answer that, and
 * a stub that returned the right number would only be testing itself.
 *
 *     npm run verify:reissue
 */
import assert from 'node:assert/strict';

import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import '../src/domain/rules/index.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { AnnotationService } from '../src/domain/services/AnnotationService.js';
import { ExportService } from '../src/domain/services/ExportService.js';
import { IdGenerator } from '../src/domain/ports/IdGenerator.js';
import { SheetExporter } from '../src/domain/ports/SheetExporter.js';
import { FlattenedSheetExporter } from '../src/infrastructure/export/FlattenedSheetExporter.js';
import { PdfLibSheetExporter } from '../src/infrastructure/export/PdfLibSheetExporter.js';
import { InMemoryAnnotationRepository } from '../src/infrastructure/persistence/InMemoryAnnotationRepository.js';
import { InMemoryExportHistoryRepository } from '../src/infrastructure/persistence/InMemoryExportHistoryRepository.js';

// --- fixtures ---------------------------------------------------------------

class SequentialIds extends IdGenerator {
  #n = 0;
  next() {
    this.#n += 1;
    return `ann-${this.#n}`;
  }
}

/**
 * A PDF that arrives with markups already on it — what re-opening an exported
 * working copy actually hands us.
 *
 * Each annotation gets a real `/AP /N` appearance stream, because that is what
 * the flattener paints. One without it (a viewer-drawn sticky note) has no
 * artwork to burn in and is deliberately left alone; a check below relies on
 * that, so this can produce both kinds.
 */
async function drawingWithExistingMarkups({ withAppearance = 2, withoutAppearance = 0 } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const refs = [];

  for (let i = 0; i < withAppearance; i++) {
    const rect = [100 + i * 50, 100, 180 + i * 50, 180];
    const appearance = doc.context.register(
      doc.context.stream(`1 0 0 RG 2 w ${rect[0]} ${rect[1]} 80 80 re S`, {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: rect,
        Resources: doc.context.obj({}),
      }),
    );
    refs.push(
      doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: rect, AP: { N: appearance } }),
      ),
    );
  }

  for (let i = 0; i < withoutAppearance; i++) {
    refs.push(
      doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 400, 420, 420] }),
      ),
    );
  }

  page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  return doc.save();
}

/** A clean drawing, straight from the architect. */
async function drawingWithNoMarkups() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

/** How many annotations a saved PDF still has on page 0. */
async function annotationsLeftOn(bytes) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return annots?.size() ?? 0;
}

const SHEET = 'drawing.pdf#0';

function buildService(exporter) {
  const repository = new InMemoryAnnotationRepository();
  const ids = new SequentialIds();
  const annotations = new AnnotationService(repository, ids);
  const exports = new ExportService(
    annotations,
    exporter,
    new InMemoryExportHistoryRepository(),
    ids,
  );
  return { repository, annotations, exports };
}

function pin(id) {
  return new Pin(
    id,
    SHEET,
    new PdfPoint(300, 300),
    'Cracked tile',
    PinStatus.OPEN,
    new Date('2026-09-24T12:00:00Z'),
  );
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

/**
 * The gate `useExport` applies. Written here as one expression so a change to
 * the rule has to be made in both places deliberately, rather than drifting.
 */
const refusesToExport = ({ annotationCount, flattenedCount }) =>
  annotationCount === 0 && flattenedCount === 0;

// --- the checks -------------------------------------------------------------

check('THE REPORTED BUG: a re-opened export can be issued', async () => {
  const { exports } = buildService(new FlattenedSheetExporter());

  const result = await exports.exportDocument({
    sourceBytes: await drawingWithExistingMarkups({ withAppearance: 2 }),
    pageCount: 1,
    // Exporting renamed the file, so this sheet id matches nothing we are
    // holding — exactly the situation that caused the refusal.
    sheetIdFor: () => 'drawing-marked-up.pdf#0',
    documentName: 'drawing-marked-up.pdf',
  });

  assert.equal(result.annotationCount, 0, 'none of these markups are ours');
  assert.equal(result.flattenedCount, 2, 'but two were burned into the page');
  assert.equal(result.flattenedPages, 1);
  assert.equal(refusesToExport(result), false, 'so the export must go ahead');
});

check('the markups are painted, not merely deleted', async () => {
  const exporter = new FlattenedSheetExporter();
  const { bytes, flattenedCount } = await exporter.exportAnnotated({
    sourceBytes: await drawingWithExistingMarkups({ withAppearance: 2 }),
    pages: [],
    author: 'Verifier',
  });

  assert.equal(flattenedCount, 2);
  assert.equal(await annotationsLeftOn(bytes), 0, 'nothing left for a viewer to drop');

  // The appearances have to be INVOKED from the page, or "flattened" would just
  // mean "erased" — the one outcome worse than the bug being fixed.
  const text = Buffer.from(bytes).toString('latin1');
  const invocations = text.match(/\/PLMarkup\d+ Do/g) ?? [];
  assert.equal(invocations.length, 2, 'each markup is drawn into the content stream');
});

check('a genuinely empty drawing is still refused', async () => {
  const { exports } = buildService(new FlattenedSheetExporter());

  const result = await exports.exportDocument({
    sourceBytes: await drawingWithNoMarkups(),
    pageCount: 1,
    sheetIdFor: () => SHEET,
    documentName: 'drawing.pdf',
  });

  assert.equal(result.annotationCount, 0);
  assert.equal(result.flattenedCount, 0);
  assert.equal(result.flattenedPages, 0);
  assert.equal(refusesToExport(result), true, 'the old message was right in THIS case');
});

check("our own markups and the file's are counted together", async () => {
  const { repository, exports } = buildService(new FlattenedSheetExporter());
  await repository.save(pin('a'));

  const result = await exports.exportDocument({
    sourceBytes: await drawingWithExistingMarkups({ withAppearance: 2 }),
    pageCount: 1,
    sheetIdFor: () => SHEET,
    documentName: 'drawing.pdf',
  });

  assert.equal(result.annotationCount, 1, 'one of them is ours');
  assert.equal(result.flattenedCount, 3, 'three end up on the page');
  assert.equal(await annotationsLeftOn(result.bytes), 0);

  // Only OUR markup is sealed. The file's annotations are not ours to freeze —
  // we are not holding them, and they are already read-only in this app.
  assert.deepEqual(result.sealed.annotationIdsBySheet, { [SHEET]: ['a'] });
});

check('an annotation with no appearance is left for the viewer to draw', async () => {
  const exporter = new FlattenedSheetExporter();
  const { bytes, flattenedCount } = await exporter.exportAnnotated({
    sourceBytes: await drawingWithExistingMarkups({ withAppearance: 1, withoutAppearance: 1 }),
    pages: [],
    author: 'Verifier',
  });

  assert.equal(flattenedCount, 1, 'only the one with artwork is burned in');
  assert.equal(await annotationsLeftOn(bytes), 1, 'the sticky note survives');
});

check('a NATIVE export still returns bare bytes, and is unaffected', async () => {
  const { repository, exports } = buildService(new PdfLibSheetExporter());
  await repository.save(pin('a'));

  const result = await exports.exportDocument({
    sourceBytes: await drawingWithNoMarkups(),
    pageCount: 1,
    sheetIdFor: () => SHEET,
    documentName: 'drawing.pdf',
  });

  // The widened return is opt-in. An exporter that says nothing extra reports
  // zero, and the caller falls back to its own count — which is why this fix
  // could not disturb the native path.
  assert.ok(result.bytes instanceof Uint8Array);
  assert.equal(result.annotationCount, 1);
  assert.equal(result.flattenedCount, 0);
  assert.equal(refusesToExport(result), false, 'our own count carries it');
  assert.equal(await annotationsLeftOn(result.bytes), 1, 'native means it stays an annotation');
});

check('a native export of nothing is still refused', async () => {
  const { exports } = buildService(new PdfLibSheetExporter());

  const result = await exports.exportDocument({
    sourceBytes: await drawingWithNoMarkups(),
    pageCount: 1,
    sheetIdFor: () => SHEET,
    documentName: 'drawing.pdf',
  });

  assert.equal(refusesToExport(result), true);
});

check('an exporter may return bytes OR a report — both normalise', async () => {
  // The contract widened rather than changed, so an implementation written
  // before this fix still satisfies it. This is that implementation.
  class LegacyExporter extends SheetExporter {
    async exportAnnotated() {
      return new Uint8Array([1, 2, 3]);
    }
    seals() {
      return true;
    }
  }

  const { repository, exports } = buildService(new LegacyExporter());
  await repository.save(pin('a'));

  const result = await exports.exportDocument({
    sourceBytes: await drawingWithNoMarkups(),
    pageCount: 1,
    sheetIdFor: () => SHEET,
    documentName: 'drawing.pdf',
  });

  assert.deepEqual(Array.from(result.bytes), [1, 2, 3], 'the bytes pass through untouched');
  assert.equal(result.flattenedCount, 0);
  assert.equal(result.flattenedPages, 0);
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
    ? `\n${checks.length}/${checks.length} re-issue checks passed.`
    : `\n${failed} of ${checks.length} re-issue checks FAILED.`,
);

process.exit(failed === 0 ? 0 : 1);
