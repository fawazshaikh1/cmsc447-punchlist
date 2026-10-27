/**
 * Checks the drawing library (FR-10): a project keeps its PDFs on the server,
 * so a drawing is added once and opened from any device by anyone on it.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. ONLY THE RIGHT DRAWINGS ARE OFFERED: a drawing opened as itself is; a
 *    returned working copy (which opens as the drawing it came from) is not,
 *    because its bytes are not that drawing's.
 * 2. ONLY AN ADMIN CHANGES THE LIBRARY, as FR-10.4 says — the interface's
 *    half; the server refuses anyone else regardless (documents_test.go).
 * 3. THE HTTP ADAPTER sends the PDF as raw bytes under its name, with the app
 *    header, and turns the server's refusal into its own sentence.
 *
 * Run with: npm run verify -- library
 */
import assert from 'node:assert/strict';

import { LibraryDrawing, belongsInLibrary, canChangeLibrary } from '../src/domain/library/index.js';
import { DrawingLibrary } from '../src/domain/ports/DrawingLibrary.js';
import { ProjectRole } from '../src/domain/projects/ProjectRole.js';
import { HttpDrawingLibrary } from '../src/infrastructure/library/HttpDrawingLibrary.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const dto = (fields = {}) => ({
  id: 7,
  name: 'A-101 Ground floor.pdf',
  byteSize: 12_582_912,
  uploadedBy: 'Sam Rivera',
  uploadedAt: '2026-10-27T14:05:00Z',
  ...fields,
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    return handler(url, init);
  };
  return { fn, calls };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// =========================================================================
// THE DRAWING RECORD
// =========================================================================

check('a library drawing keeps what the server says about it', () => {
  const drawing = LibraryDrawing.fromJSON(dto());
  assert.equal(drawing.id, 7);
  assert.equal(drawing.name, 'A-101 Ground floor.pdf');
  assert.equal(drawing.uploadedBy, 'Sam Rivera');
  assert.ok(Object.isFrozen(drawing));
});

check('its size reads the way a person thinks of a download', () => {
  assert.equal(LibraryDrawing.fromJSON(dto({ byteSize: 12_582_912 })).sizeLabel, '12 MB');
  assert.equal(LibraryDrawing.fromJSON(dto({ byteSize: 3_250_000 })).sizeLabel, '3.1 MB');
  assert.equal(LibraryDrawing.fromJSON(dto({ byteSize: 40_000 })).sizeLabel, '39 KB');
  assert.equal(LibraryDrawing.fromJSON(dto({ byteSize: 10 })).sizeLabel, '1 KB');
});

check('a malformed drawing is refused where it enters, not where it is shown', () => {
  assert.throws(() => LibraryDrawing.fromJSON(dto({ id: 0 })), /id/);
  assert.throws(() => LibraryDrawing.fromJSON(dto({ name: '  ' })), /name/);
  assert.throws(() => LibraryDrawing.fromJSON(dto({ byteSize: -1 })), /size/);
  assert.throws(() => LibraryDrawing.fromJSON(dto({ uploadedAt: 'yesterday' })), /time/);
});

// =========================================================================
// THE RULES
// =========================================================================

check('only an admin adds or removes drawings (FR-10.4)', () => {
  assert.equal(canChangeLibrary(ProjectRole.ADMIN), true);
  assert.equal(canChangeLibrary(ProjectRole.POWER_COLLABORATOR), false);
  assert.equal(canChangeLibrary(ProjectRole.COLLABORATOR), false);
  assert.equal(canChangeLibrary(undefined), false);
});

check('a drawing opened as itself is offered to the library', () => {
  assert.equal(belongsInLibrary({ fileName: 'A-101.pdf', documentName: 'A-101.pdf' }), true);
});

check('a returned working copy is not — it opens as the drawing it came from', () => {
  assert.equal(belongsInLibrary({ fileName: 'A-101-marked-up.pdf', documentName: 'A-101.pdf' }), false);
});

check('nothing that failed to open is offered', () => {
  assert.equal(belongsInLibrary({ fileName: null, documentName: null }), false);
  assert.equal(belongsInLibrary({ fileName: 'A-101.pdf', documentName: null }), false);
});

// =========================================================================
// THE PORT
// =========================================================================

check('a library that forgets a method fails when it is made, not when it is used', () => {
  class Incomplete extends DrawingLibrary {
    async list() {
      return [];
    }
  }
  assert.throws(() => new Incomplete(), /add|open|remove/);
});

// =========================================================================
// THE HTTP ADAPTER
// =========================================================================

check('the list is read from the project and becomes drawings', async () => {
  const { fn, calls } = fakeFetch(() => json([dto(), dto({ id: 8, name: 'S-201.pdf' })]));
  const library = new HttpDrawingLibrary('/api', fn);

  const list = await library.list(3);

  assert.equal(calls[0].url, '/api/projects/3/documents');
  assert.deepEqual(
    list.map((d) => d.name),
    ['A-101 Ground floor.pdf', 'S-201.pdf'],
  );
  assert.ok(list.every((d) => d instanceof LibraryDrawing));
});

check('adding sends the PDF itself under its name, with the app header', async () => {
  const { fn, calls } = fakeFetch(() => json(dto(), 201));
  const library = new HttpDrawingLibrary('/api', fn);
  const pdf = new Blob(['%PDF-1.7 …'], { type: 'application/pdf' });

  const added = await library.add(3, 'A-101 Ground floor.pdf', pdf);

  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, '/api/projects/3/documents?name=A-101%20Ground%20floor.pdf');
  assert.equal(calls[0].headers['Content-Type'], 'application/pdf');
  assert.equal(calls[0].headers['X-Punchlist-Request'], '1');
  assert.equal(calls[0].body, pdf, 'raw bytes, not JSON or base64');
  assert.equal(added.id, 7);
});

check('a name taken by a different drawing is refused in the server’s words', async () => {
  const sentence = 'This project already has a different drawing called A-101.pdf. Rename the file to add it as well.';
  const { fn } = fakeFetch(() => json({ error: sentence }, 409));
  const library = new HttpDrawingLibrary('/api', fn);

  await assert.rejects(library.add(3, 'A-101.pdf', new Blob(['%PDF-'])), (error) => {
    assert.equal(error.message, sentence);
    assert.equal(error.status, 409);
    return true;
  });
});

check('opening fetches the drawing’s bytes through its project', async () => {
  const bytes = new Blob(['%PDF-1.7 drawing'], { type: 'application/pdf' });
  const { fn, calls } = fakeFetch(() => new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
  const library = new HttpDrawingLibrary('/api', fn);

  const pdf = await library.open(3, LibraryDrawing.fromJSON(dto()));

  assert.equal(calls[0].url, '/api/projects/3/documents/7');
  assert.equal(await pdf.text(), '%PDF-1.7 drawing');
});

check('removing deletes it from its project', async () => {
  const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }));
  const library = new HttpDrawingLibrary('/api', fn);

  await library.remove(3, LibraryDrawing.fromJSON(dto()));

  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, '/api/projects/3/documents/7');
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

console.log(`\n${checks.length - failed}/${checks.length} drawing library checks passed.`);
process.exit(failed === 0 ? 0 : 1);
