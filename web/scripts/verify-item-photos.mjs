/**
 * Checks photos attached to punch items, and the detail page each item gets in
 * the issued PDF (SCRUM-88, FR-6.4, D2).
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. A PHOTO BELONGS TO AN ITEM, read and written in the server's terms.
 * 2. THE SCHEDULE KNOWS WHICH ITEM EACH LINE IS, so its photos can be found.
 * 3. THE ISSUED PDF ENDS WITH A PAGE PER ITEM: its number, sheet, status,
 *    description, every recorded field, and its photos — embedded, not
 *    linked, because a photo that only exists in the app is a photo the
 *    architect never sees (D2). Too many photos for one page continue on the
 *    next; a photo that cannot be loaded says so rather than failing the issue.
 *
 * Read back out of a real PDF, like verify-punchlist, because the question is
 * what reaches the file.
 *
 * Run with: npm run verify -- item-photos
 */
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFArray, PDFRawStream } from 'pdf-lib';

import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import '../src/domain/rules/index.js';
import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { MediaRef } from '../src/domain/media/MediaRef.js';
import { ItemPhoto } from '../src/domain/itemphotos/index.js';
import { ItemPhotoRepository } from '../src/domain/ports/ItemPhotoRepository.js';
import { PunchListRegistry } from '../src/domain/punchlist/index.js';
import { FlattenedSheetExporter } from '../src/infrastructure/export/FlattenedSheetExporter.js';
import { PunchListPageWriter } from '../src/infrastructure/export/PunchListPageWriter.js';
import { PunchListDetailWriter } from '../src/infrastructure/export/PunchListDetailWriter.js';
import { HttpItemPhotoRepository } from '../src/infrastructure/itemphotos/HttpItemPhotoRepository.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// --- fixtures ---------------------------------------------------------------

const SHEET = 'p7:drawing.pdf#0';
const casey = new Actor({ id: '3', displayName: 'Casey Collab', company: 'Metro Drywall', role: 'collaborator' });

const pin = (id, label, status = PinStatus.OPEN) =>
  new Pin(id, SHEET, new PdfPoint(300, 400), label, status, new Date('2026-11-02T12:00:00Z'));

const photoRow = (id, annotationId, key, caption = '') => ({
  id,
  annotationId,
  media: { key, mimeType: 'image/png', width: 1600, height: 1200, byteSize: 70 },
  caption,
  addedBy: casey.toJSON(),
  addedAt: '2026-11-10T15:30:00Z',
});

// A 1x1 PNG: real image bytes, so pdf-lib embeds it as it would a photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

class FakePhotos extends ItemPhotoRepository {
  constructor(byItem) {
    super();
    this.byItem = byItem;
    this.asked = [];
  }
  async listFor(annotationId) {
    return this.byItem.get(annotationId) ?? [];
  }
  async listForProject(projectId) {
    this.asked.push(projectId);
    return this.byItem;
  }
  async add() {
    throw new Error('not used');
  }
  async remove() {
    throw new Error('not used');
  }
}

const media = (missing = new Set()) => ({
  get: async (key) => (missing.has(key) ? null : new Blob([PNG], { type: 'image/png' })),
});

async function blankSheet() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

function decodeStream(stream) {
  if (!stream) return '';
  const raw = stream.getContents?.();
  if (!raw) return '';
  try {
    return Buffer.from(inflateSync(Buffer.from(raw))).toString('latin1');
  } catch {
    return Buffer.from(raw).toString('latin1');
  }
}

/** The text drawn on each page, one string per page. */
async function pageTexts(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.normalizedEntries?.().Contents ?? page.node.get(PDFName.of('Contents'));
    const resolved = doc.context.lookup(contents);
    const streams = resolved instanceof PDFArray
      ? Array.from({ length: resolved.size() }, (_, i) => doc.context.lookup(resolved.get(i)))
      : [resolved];
    const found = [];
    for (const stream of streams) {
      const text = decodeStream(stream);
      for (const match of text.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) found.push(match[1].replace(/\\([()\\])/g, '$1'));
      for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
        found.push(Buffer.from(match[1].replace(/\s+/g, ''), 'hex').toString('latin1'));
      }
    }
    return found.join('\n');
  });
}

async function imageCount(bytes) {
  const doc = await PDFDocument.load(bytes);
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) count += 1;
  }
  return count;
}

function issueWith(byItem, { missing } = {}) {
  const photos = new FakePhotos(byItem);
  const exporter = new FlattenedSheetExporter({
    media: media(missing),
    reports: [new PunchListPageWriter(), new PunchListDetailWriter({ itemPhotos: photos })],
  });
  return { photos, exporter };
}

// =========================================================================
// 1. THE PHOTO
// =========================================================================

check('a photo is read with its item, the stored image, who added it and when', () => {
  const photo = ItemPhoto.fromJSON(photoRow('ph1', 'pin-1', 'k1', 'Closer fitted'));
  assert.equal(photo.annotationId, 'pin-1');
  assert.ok(photo.media instanceof MediaRef);
  assert.equal(photo.media.key, 'k1');
  assert.equal(photo.caption, 'Closer fitted');
  assert.equal(String(photo.addedBy), 'Casey Collab (Metro Drywall)');
  assert.equal(photo.addedAt.toISOString(), '2026-11-10T15:30:00.000Z');
  assert.equal(ItemPhoto.fromJSON({ id: 'x' }), null, 'a row this build cannot read is left out');
});

function fakeServer(respond) {
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url, 'http://localhost').pathname;
    requests.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const answer = respond(method, path);
    if (answer === 404) return new Response(JSON.stringify({ error: 'gone' }), { status: 404 });
    return answer === undefined
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { requests, fetchFn };
}

check('the adapter reads an item’s photos and the project’s, adds one and removes one', async () => {
  const server = fakeServer((method, path) => {
    if (method === 'GET' && path.endsWith('/item-photos')) return { 'pin 1': [photoRow('a', 'pin 1', 'k1')] };
    if (method === 'GET') return [photoRow('a', 'pin 1', 'k1'), { id: 'odd' }];
    if (method === 'POST') return photoRow('new-id', 'pin 1', 'k2', 'Fixed');
    return 404;
  });
  const repo = new HttpItemPhotoRepository('/api', server.fetchFn, () => 'new-id');

  assert.deepEqual((await repo.listFor('pin 1')).map((p) => p.id), ['a']);
  assert.deepEqual([...(await repo.listForProject(7)).get('pin 1')].map((p) => p.id), ['a']);
  const added = await repo.add({
    annotation: pin('pin 1', 'x'),
    media: new MediaRef({ key: 'k2', mimeType: 'image/jpeg', width: 800, height: 600, byteSize: 9 }),
    caption: '  Fixed  ',
  });
  assert.equal(added.id, 'new-id');
  await repo.remove(added);

  assert.deepEqual(server.requests.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/annotations/pin%201/photos',
    'GET /api/projects/7/item-photos',
    'POST /api/annotations/pin%201/photos',
    'DELETE /api/item-photos/new-id',
  ]);
  assert.deepEqual(server.requests[2].body, {
    id: 'new-id',
    media: { key: 'k2', mimeType: 'image/jpeg', width: 800, height: 600, byteSize: 9 },
    caption: 'Fixed',
  });
});

// =========================================================================
// 2. THE SCHEDULE KNOWS ITS ITEMS
// =========================================================================

check('each line of the schedule knows which item it is', () => {
  const entries = PunchListRegistry.collect([{ pageIndex: 0, annotations: [pin('a', 'One'), pin('b', 'Two')] }]);
  assert.deepEqual(entries.map((entry) => entry.itemId), ['a', 'b']);
  assert.equal(entries[0].withSheetLabel('A-101').itemId, 'a', 'and still does once its sheet is named');
});

// =========================================================================
// 3. DETAIL PAGES
// =========================================================================

check('the issued PDF ends with a page per item, its photos embedded', async () => {
  const first = pin('a', 'Fire door closer missing at stair 2').withDetail('trade', 'Doors & Hardware');
  const second = pin('b', 'Ceiling tile stained at grid C4', PinStatus.READY_FOR_REVIEW);
  const { photos, exporter } = issueWith(new Map([['a', [ItemPhoto.fromJSON(photoRow('p1', 'a', 'k1', 'Closer fitted')), ItemPhoto.fromJSON(photoRow('p2', 'a', 'k2'))]]]));

  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [first, second], sheetLabel: 'A-101' }],
    author: 'Verifier',
    documentName: 'drawing.pdf',
  });

  const texts = await pageTexts(bytes);
  assert.equal(texts.length, 4, 'the drawing, the schedule, then one page for each of the two items');
  assert.match(texts[1], /PUNCH LIST/);
  assert.match(texts[2], /ITEM 1/);
  assert.match(texts[2], /A-101/);
  assert.match(texts[2], /Fire door closer missing at stair 2/);
  assert.match(texts[2], /Trade: Doors & Hardware/);
  assert.match(texts[2], /2 photos/);
  assert.match(texts[2], /Closer fitted/);
  assert.match(texts[2], /Added by Casey Collab \(Metro Drywall\)/);
  assert.match(texts[3], /ITEM 2/);
  assert.match(texts[3], /READY FOR REVIEW/i);
  assert.match(texts[3], /No photos attached/);
  assert.ok((await imageCount(bytes)) >= 2, 'both photos are in the file');
  assert.deepEqual(photos.asked, [7], 'the project’s photos are read once, by its id');
});

check('more photos than a page holds continue on the next page', async () => {
  const many = Array.from({ length: 7 }, (_, i) => ItemPhoto.fromJSON(photoRow(`p${i}`, 'a', `k${i}`, `Photo ${i + 1}`)));
  const { exporter } = issueWith(new Map([['a', many]]));
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('a', 'Many photos')] }],
    author: 'Verifier',
    documentName: 'drawing.pdf',
  });
  const texts = await pageTexts(bytes);
  assert.ok(texts.length >= 4, 'the drawing, the schedule and at least two pages for the item');
  assert.match(texts.at(-1), /ITEM 1 \(continued\)/);
  assert.match(texts.slice(2).join('\n'), /Photo 7/, 'the last photo is there');
});

check('a photo that cannot be loaded is named on the page instead of failing the issue', async () => {
  const { exporter } = issueWith(new Map([['a', [ItemPhoto.fromJSON(photoRow('p1', 'a', 'lost'))]]]), { missing: new Set(['lost']) });
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('a', 'Lost photo')] }],
    author: 'Verifier',
    documentName: 'drawing.pdf',
  });
  assert.match((await pageTexts(bytes))[2], /Photo not available/);
});

check('with nowhere to read photos from, the detail pages are still there', async () => {
  const exporter = new FlattenedSheetExporter({ reports: [new PunchListPageWriter(), new PunchListDetailWriter()] });
  const { bytes } = await exporter.exportAnnotated({
    sourceBytes: await blankSheet(),
    pages: [{ pageIndex: 0, annotations: [pin('a', 'Browser mode item')] }],
    author: 'Verifier',
    documentName: 'drawing.pdf',
  });
  const texts = await pageTexts(bytes);
  assert.equal(texts.length, 3);
  assert.match(texts[2], /Browser mode item/);
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

console.log(`\n${checks.length - failed}/${checks.length} item photo checks passed.`);
process.exit(failed === 0 ? 0 : 1);
