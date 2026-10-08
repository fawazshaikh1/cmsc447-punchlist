/**
 * Checks that a working copy can be reopened and edited.
 *
 * ===========================================================================
 * THE REPORTED BUG
 * ===========================================================================
 * Export a working copy, open it again, and the pins on it cannot be selected.
 * They were not pins any more: the export renames the file, the app keys
 * markups by file name, so the reopened copy had no markups of its own — and
 * what looked like pins were the exported PDF annotations, painted into the
 * page picture by pdf.js.
 *
 * These checks run the REAL exporter and the REAL reader against real PDF
 * bytes, with no browser: export, reopen, and prove the markups come back as
 * live markups, the file stops drawing them underneath, and nothing anyone
 * else wrote in the file is touched.
 *
 * Run with: npm run verify -- working-copy
 */
import assert from 'node:assert/strict';

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import { PhotoMarkup } from '../src/domain/annotations/PhotoMarkup.js';
import { ChangeRecord } from '../src/domain/audit/ChangeRecord.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { MediaRef } from '../src/domain/media/MediaRef.js';
import { WorkingCopyReader } from '../src/domain/ports/WorkingCopyReader.js';
import { WorkingCopyService } from '../src/domain/services/WorkingCopyService.js';
import { PdfLibSheetExporter } from '../src/infrastructure/export/PdfLibSheetExporter.js';
import { InMemoryAnnotationRepository } from '../src/infrastructure/persistence/InMemoryAnnotationRepository.js';
import { InMemoryChangeLogRepository } from '../src/infrastructure/persistence/InMemoryChangeLogRepository.js';
import { PdfLibWorkingCopyReader } from '../src/infrastructure/workingcopy/PdfLibWorkingCopyReader.js';
import {
  DOCUMENT_KEY,
  MARKUP_KEY,
  mightBeWorkingCopy,
} from '../src/infrastructure/workingcopy/workingCopyFormat.js';

const ORIGINAL_SHEET = 'drawing.pdf#0';
const REOPENED = (pageIndex) => `drawing-marked-up.pdf#${pageIndex}`;

// --- fixtures ---------------------------------------------------------------

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/**
 * A one-page "drawing" with linework in its content stream and a comment an
 * architect already left on it — the thing we must never disturb.
 */
async function drawingWithArchitectComment() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 50, y: 50, width: 500, height: 680, borderWidth: 2 });

  const note = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [20, 20, 40, 40],
      Contents: PDFHexString.fromText('Architect: check the door swing'),
    }),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj([note]));

  return toArrayBuffer(await doc.save());
}

function pin(id, label, sheetId = ORIGINAL_SHEET) {
  return new Pin(id, sheetId, new PdfPoint(200, 300), label, PinStatus.OPEN, new Date('2026-10-05T12:00:00Z'));
}

const pinA = pin('pin-a', 'Outlet cover missing')
  .withDetail('trade', 'Electrical')
  .withDetail('responsibleCompany', 'Rivera Electric')
  .withDetail('dueDate', '2026-10-10');
const pinB = pin('pin-b', 'Door binds on frame').withStatus(PinStatus.READY_FOR_REVIEW);

async function exportWorkingCopy(sourceBytes, annotations, exporter = new PdfLibSheetExporter()) {
  const bytes = await exporter.exportAnnotated({
    sourceBytes,
    pages: [{ pageIndex: 0, annotations }],
    author: 'Verifier',
  });
  return toArrayBuffer(bytes);
}

/** Every annotation on page 0, as { ours, contents }. */
async function annotationsIn(bytes) {
  const doc = await PDFDocument.load(bytes.slice(0));
  const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const result = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const dict = annots.lookup(i, PDFDict);
    result.push({
      ours: dict.has(PDFName.of(MARKUP_KEY)),
      contents: dict.lookupMaybe(PDFName.of('Contents'), PDFHexString)?.decodeText() ?? '',
    });
  }
  return { result, marked: doc.catalog.has(PDFName.of(DOCUMENT_KEY)) };
}

/** The page's drawing — its content stream, decoded. */
async function contentOf(bytes) {
  const doc = await PDFDocument.load(bytes.slice(0));
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams.map((stream) => Buffer.from(stream.getContents()).toString('latin1')).join('\n');
}

function build({ media = null } = {}) {
  const repository = new InMemoryAnnotationRepository();
  const changeLog = new InMemoryChangeLogRepository();
  const service = new WorkingCopyService(new PdfLibWorkingCopyReader(), repository, { changeLog, media });
  return { repository, changeLog, service };
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// THE REPORTED BUG
// =========================================================================

check('THE REPORTED BUG: a reopened working copy\'s pins are live markups again', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, pinB]);
  const { repository, service } = build();

  const { restored } = await service.open(copy, REOPENED);
  const live = await repository.listBySheet(REOPENED(0));

  assert.equal(restored, 2);
  assert.deepEqual(live.map((a) => a.id), ['pin-a', 'pin-b'], 'same ids, same order — so the same numbers');
  assert.ok(live.every((a) => a instanceof Pin), 'real Pins the select tool can pick up');
  assert.equal(live[0].sheetId, REOPENED(0), 're-homed onto the sheet of the file actually open');
});

check('everything about a markup survives the round trip', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, pinB]);
  const { repository, service } = build();
  await service.open(copy, REOPENED);

  const [a, b] = await repository.listBySheet(REOPENED(0));
  assert.equal(a.label, 'Outlet cover missing');
  assert.deepEqual(a.details.toJSON(), pinA.details.toJSON());
  assert.equal(b.status, PinStatus.READY_FOR_REVIEW);
  assert.equal(a.position.x, 200);
  assert.equal(a.position.y, 300);
  assert.equal(a.createdAt.toISOString(), pinA.createdAt.toISOString());
});

check('restored markups leave the file, so they are not drawn twice', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, pinB]);
  const { service } = build();

  const { bytes } = await service.open(copy, REOPENED);
  const { result, marked } = await annotationsIn(bytes);

  assert.deepEqual(result.map((a) => a.ours), [false], 'only the architect\'s comment is left');
  assert.equal(marked, false, 'nothing of ours left, so the file is no longer marked');
});

check('the architect\'s comment and the drawing itself are untouched', async () => {
  const source = await drawingWithArchitectComment();
  const copy = await exportWorkingCopy(source, [pinA, pinB]);
  const { bytes } = await build().service.open(copy, REOPENED);

  const { result } = await annotationsIn(bytes);
  assert.equal(result[0].contents, 'Architect: check the door swing');
  assert.equal(await contentOf(bytes), await contentOf(source), 'page content stream byte-identical');
});

check('re-exporting a reopened working copy does not duplicate a single markup', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, pinB]);
  const { repository, service } = build();
  const { bytes } = await service.open(copy, REOPENED);

  const again = await exportWorkingCopy(bytes, await repository.listBySheet(REOPENED(0)));
  const { result } = await annotationsIn(again);

  assert.equal(result.filter((a) => a.ours).length, 2, 'two pins, not four');
  assert.equal(result.filter((a) => !a.ours).length, 1, 'one architect comment, not two');
});

check('reopening the same copy a second time restores nothing twice', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, pinB]);
  const { repository, service } = build();

  await service.open(copy, REOPENED);
  const second = await service.open(copy, REOPENED);

  assert.equal(second.restored, 0);
  assert.equal((await repository.listBySheet(REOPENED(0))).length, 2);
});

// =========================================================================
// WHICH COPY WINS
// =========================================================================

check('an edit made here since is kept — the file\'s older copy does not overwrite it', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, pinB]);
  const { repository, service } = build();
  await repository.save(pin('pin-a', 'Outlet cover missing — replaced, needs paint', REOPENED(0)));

  const { restored, bytes } = await service.open(copy, REOPENED);
  const [a] = await repository.listBySheet(REOPENED(0));

  assert.equal(restored, 1, 'only pin-b was new');
  assert.equal(a.label, 'Outlet cover missing — replaced, needs paint');
  assert.equal((await annotationsIn(bytes)).result.filter((x) => x.ours).length, 0, 'stale copy not drawn underneath');
});

check('a markup deleted here stays deleted when the file is reopened', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, pinB]);
  const { repository, changeLog, service } = build();
  await changeLog.record(
    new ChangeRecord({
      id: 'c1',
      annotationId: 'pin-a',
      sheetId: REOPENED(0),
      intent: 'delete',
      actor: Actor.ANONYMOUS,
      at: '2026-10-05T13:00:00Z',
    }),
  );

  await service.open(copy, REOPENED);
  assert.deepEqual((await repository.listBySheet(REOPENED(0))).map((a) => a.id), ['pin-b']);
});

check('a photo whose image is not on this device is left in the file, not destroyed', async () => {
  const photo = new PhotoMarkup(
    'photo-1',
    ORIGINAL_SHEET,
    new PdfPoint(100, 400),
    new MediaRef({ key: 'img-1', mimeType: 'image/jpeg', width: 800, height: 600 }),
    'Water stain',
    200,
    new Date('2026-10-05T12:00:00Z'),
  );
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, photo]);

  const elsewhere = build({ media: { get: async () => null } });
  const result = await elsewhere.service.open(copy, REOPENED);
  const left = await annotationsIn(result.bytes);

  assert.deepEqual((await elsewhere.repository.listBySheet(REOPENED(0))).map((a) => a.id), ['pin-a']);
  assert.equal(left.result.filter((a) => a.ours).length, 1, 'the photo stays, picture and all');
  assert.equal(left.marked, true, 'still marked, so a device that has the image can restore it');

  const here = build({ media: { get: async () => new Blob(['jpeg']) } });
  await here.service.open(copy, REOPENED);
  assert.deepEqual((await here.repository.listBySheet(REOPENED(0))).map((a) => a.id), ['pin-a', 'photo-1']);
});

check('a markup this build cannot rebuild is left in the file, read-only', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA]);

  // Rewrite the exported data as a kind from some future build.
  const doc = await PDFDocument.load(copy.slice(0));
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i, PDFDict);
    if (!dict.has(PDFName.of(MARKUP_KEY))) continue;
    const data = { v: 1, annotation: { ...pinA.toJSON(), kind: 'hologram' } };
    dict.set(PDFName.of(MARKUP_KEY), PDFHexString.fromText(JSON.stringify(data)));
  }
  const future = toArrayBuffer(await doc.save());

  const { repository, service } = build();
  const result = await service.open(future, REOPENED);

  assert.equal(result.restored, 0);
  assert.equal(result.bytes, future, 'nothing taken out, so the very same bytes');
  assert.deepEqual(await repository.listBySheet(REOPENED(0)), []);
});

// =========================================================================
// EVERYTHING ELSE IS LEFT ALONE
// =========================================================================

check('a PDF that never passed through our exporter comes back as the same buffer', async () => {
  const plain = await drawingWithArchitectComment();
  let asked = 0;

  const view = await new PdfLibWorkingCopyReader().read(plain, () => {
    asked += 1;
    return true;
  });

  assert.equal(view, plain, 'not re-saved, not copied');
  assert.equal(asked, 0);
  assert.equal(mightBeWorkingCopy(new Uint8Array(plain)), false);
});

check('a working copy is recognised from its raw bytes', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA]);
  assert.equal(mightBeWorkingCopy(new Uint8Array(copy)), true);
});

check('damaged markup data is ignored, not fatal', async () => {
  const copy = await exportWorkingCopy(await drawingWithArchitectComment(), [pinA, pinB]);

  const doc = await PDFDocument.load(copy.slice(0));
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  const first = [...Array(annots.size()).keys()].find((i) => annots.lookup(i, PDFDict).has(PDFName.of(MARKUP_KEY)));
  annots.lookup(first, PDFDict).set(PDFName.of(MARKUP_KEY), PDFHexString.fromText('{not json'));
  const damaged = toArrayBuffer(await doc.save());

  const { repository, service } = build();
  await service.open(damaged, REOPENED);
  assert.deepEqual((await repository.listBySheet(REOPENED(0))).map((a) => a.id), ['pin-b']);
});

check('a reader that fails does not stop the drawing opening', async () => {
  class Broken extends WorkingCopyReader {
    async read() {
      throw new Error('unreadable');
    }
  }
  const bytes = await drawingWithArchitectComment();
  const service = new WorkingCopyService(new Broken(), new InMemoryAnnotationRepository());

  const original = console.warn;
  console.warn = () => {};
  try {
    const result = await service.open(bytes, REOPENED);
    assert.equal(result.bytes, bytes);
    assert.equal(result.restored, 0);
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

console.log(`\n${checks.length - failed}/${checks.length} working copy checks passed.`);
process.exit(failed === 0 ? 0 : 1);
