/**
 * Checks that the app's HTTP repositories speak the Go API's language.
 *
 * ===========================================================================
 * WHAT THIS IS — AND IS NOT — PROVING
 * ===========================================================================
 * The server below is a stand-in written to the behaviour of backend/main.go
 * and backend/history.go: the same routes, the same validation, the same
 * ordering, the same "a repeated id is ignored" rule, and the same URL
 * decoding (Go hands handlers an already-decoded path). Every repository here
 * is the real one, driven through the real EditorService and ExportService.
 *
 * So this proves the app sends what the API expects and reads what it sends
 * back. It does NOT prove the Go code and Postgres behave as described — that
 * needs the real server running (`go run .` against a database built from
 * backend/schema.sql), which this suite cannot start.
 *
 * Run with: npm run verify -- http
 */
import assert from 'node:assert/strict';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import '../src/domain/rules/index.js';
import { ChangeRecord } from '../src/domain/audit/ChangeRecord.js';
import { ExportRecord } from '../src/domain/export/ExportRecord.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { CounterIdGenerator } from '../src/domain/identity/CounterIdGenerator.js';
import { IdGenerator } from '../src/domain/ports/IdGenerator.js';
import { SheetExporter } from '../src/domain/ports/SheetExporter.js';
import { AnnotationService } from '../src/domain/services/AnnotationService.js';
import { EditorService } from '../src/domain/services/EditorService.js';
import { ExportService } from '../src/domain/services/ExportService.js';
import { HttpAnnotationRepository } from '../src/infrastructure/persistence/HttpAnnotationRepository.js';
import { HttpChangeLogRepository } from '../src/infrastructure/persistence/HttpChangeLogRepository.js';
import { HttpExportHistoryRepository } from '../src/infrastructure/persistence/HttpExportHistoryRepository.js';

const API = '/api';
const SHEET = 'Level 2 plan #3.pdf#0';
const DOCUMENT = 'Level 2 plan #3.pdf';

// =========================================================================
// A stand-in for backend/main.go + backend/history.go
// =========================================================================

/** Go's time.RFC3339 output in UTC — whole seconds, "Z". */
const goRFC3339 = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
/** history.go's jsTime — milliseconds, like toISOString. */
const jsTime = (date) => date.toISOString();

function fakeGoServer({ failWith = null } = {}) {
  const annotations = new Map();
  const changes = new Map();
  const exports = new Map();
  const requests = [];

  const reply = (status, body) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    });

  async function handle(url, init = {}) {
    const method = init.method ?? 'GET';
    const parsed = new URL(url, 'http://localhost');
    // Go's r.URL.Path is already decoded — "%23" arrives as "#".
    const path = decodeURIComponent(parsed.pathname);
    requests.push(`${method} ${parsed.pathname}${parsed.search}`);

    if (failWith && failWith.test(path)) return reply(500);

    const body = () => {
      try {
        return JSON.parse(init.body);
      } catch {
        return undefined;
      }
    };

    if (path === '/api/exports/sealed') {
      const doc = parsed.searchParams.get('document');
      const sheet = parsed.searchParams.get('sheetId');
      if (!doc || !sheet) return reply(400);
      const ids = new Set();
      for (const e of exports.values()) {
        if (e.documentName === doc && e.mode === 'flattened') {
          for (const id of e.annotationIdsBySheet?.[sheet] ?? []) ids.add(id);
        }
      }
      return reply(200, [...ids]);
    }

    if (path === '/api/exports') {
      if (method === 'POST') {
        const e = body();
        if (!e) return reply(400);
        if (!e.id || !e.documentName) return reply(400);
        if (e.mode !== 'flattened' && e.mode !== 'native') return reply(400);
        if (Number.isNaN(Date.parse(e.exportedAt))) return reply(400);
        if (!exports.has(e.id)) exports.set(e.id, { ...e, exportedAt: new Date(e.exportedAt) });
        return reply(204);
      }
      if (method === 'GET') {
        const doc = parsed.searchParams.get('document');
        if (!doc) return reply(400);
        const list = [...exports.values()]
          .filter((e) => e.documentName === doc)
          .sort((a, b) => b.exportedAt - a.exportedAt || b.id.localeCompare(a.id))
          .map((e) => ({ ...e, exportedAt: jsTime(e.exportedAt) }));
        return reply(200, list);
      }
      return reply(405);
    }

    if (path.startsWith('/api/annotations/')) {
      const id = path.slice('/api/annotations/'.length);
      if (!id || id.includes('/')) return reply(404);

      if (method === 'PUT') {
        const a = body();
        if (!a) return reply(400);
        const held = annotations.get(id);
        const created = held?.createdAt ?? (Number.isNaN(Date.parse(a.createdAt)) ? new Date() : new Date(a.createdAt));
        annotations.set(id, {
          id,
          sheetId: a.sheetId,
          kind: a.kind,
          x: a.x,
          y: a.y,
          payload: a.payload ?? {},
          createdAt: created,
        });
        return reply(204);
      }
      if (method === 'DELETE') {
        annotations.delete(id);
        return reply(204);
      }
      return reply(405);
    }

    if (path.startsWith('/api/sheets/')) {
      const parts = path.slice('/api/sheets/'.length).split('/');
      const sheetId = parts[0];
      if (parts.length < 2 || !sheetId) return reply(404);

      if (parts.length === 2 && parts[1] === 'annotations') {
        if (method === 'GET') {
          const list = [...annotations.values()]
            .filter((a) => a.sheetId === sheetId)
            .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
            .map((a) => ({ ...a, createdAt: goRFC3339(a.createdAt) }));
          return reply(200, list);
        }
        if (method === 'DELETE') {
          for (const [id, a] of annotations) if (a.sheetId === sheetId) annotations.delete(id);
          return reply(204);
        }
        return reply(405);
      }

      if (parts.length === 4 && parts[1] === 'annotations' && parts[2] && parts[3] === 'changes') {
        if (method !== 'GET') return reply(405);
        const list = [...changes.values()]
          .filter((c) => c.sheetId === sheetId && c.annotationId === parts[2])
          .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
          .map((c) => ({ ...c, at: jsTime(c.at) }));
        return reply(200, list);
      }

      if (parts.length === 2 && parts[1] === 'changes') {
        if (method !== 'POST') return reply(405);
        const c = body();
        if (!c) return reply(400);
        if (!c.id || !c.annotationId || !c.intent) return reply(400);
        if (Number.isNaN(Date.parse(c.at))) return reply(400);
        if (!changes.has(c.id)) changes.set(c.id, { ...c, sheetId, at: new Date(c.at), actor: c.actor ?? {} });
        return reply(204);
      }

      if (parts.length === 3 && parts[1] === 'changes' && parts[2] === 'latest') {
        if (method !== 'GET') return reply(405);
        const latest = {};
        for (const c of [...changes.values()]
          .filter((c) => c.sheetId === sheetId)
          .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
          latest[c.annotationId] = { ...c, at: jsTime(c.at) };
        }
        return reply(200, latest);
      }
    }

    return reply(404);
  }

  return { fetch: handle, annotations, changes, exports, requests };
}

// --- fixtures ---------------------------------------------------------------

class SequentialIds extends IdGenerator {
  #n = 0;
  next() {
    this.#n += 1;
    return `id-${this.#n}`;
  }
}

class SealingExporter extends SheetExporter {
  async exportAnnotated() {
    return new Uint8Array([1, 2, 3]);
  }
  seals() {
    return true;
  }
}

function pin(id, label = 'Outlet cover missing') {
  return new Pin(id, SHEET, new PdfPoint(120, 340), label, PinStatus.OPEN, new Date('2026-10-08T14:03:22.517Z'));
}

function connect(server) {
  return {
    repository: new HttpAnnotationRepository(API, server.fetch),
    changeLog: new HttpChangeLogRepository(API, server.fetch),
    exportHistory: new HttpExportHistoryRepository(API, server.fetch),
  };
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// MARKUPS
// =========================================================================

check('a markup saved through the app comes back from the server, details and all', async () => {
  const server = fakeGoServer();
  const { repository } = connect(server);
  const saved = pin('p1').withDetail('trade', 'Electrical').withDetail('dueDate', '2026-10-10');

  await repository.save(saved);
  const [loaded] = await repository.listBySheet(SHEET);

  assert.ok(loaded instanceof Pin);
  assert.equal(loaded.id, 'p1');
  assert.equal(loaded.sheetId, SHEET, 'a sheet id with spaces and two # survives the URL');
  assert.deepEqual(loaded.details.toJSON(), saved.details.toJSON());
  assert.ok(server.requests.includes('PUT /api/annotations/p1'));
  assert.ok(
    server.requests.some((r) => r.startsWith('GET /api/sheets/Level%202%20plan%20%233.pdf%230/annotations')),
    'the # is encoded, or the server would never see the page index',
  );
});

check('the server keeps the first created time; moving a pin does not reorder the list', async () => {
  const server = fakeGoServer();
  const { repository } = connect(server);

  await repository.save(pin('p1'));
  await repository.save(new Pin('p2', SHEET, new PdfPoint(1, 1), 'Second', PinStatus.OPEN, new Date('2026-10-08T15:00:00Z')));
  await repository.save(pin('p1').movedBy(50, 0));

  assert.deepEqual((await repository.listBySheet(SHEET)).map((a) => a.id), ['p1', 'p2']);
});

check('deleting, clearing, and deleting something already gone all work', async () => {
  const server = fakeGoServer();
  const { repository } = connect(server);
  await repository.save(pin('p1'));
  await repository.save(pin('p2'));

  await repository.delete('p1');
  await repository.delete('p1');
  assert.deepEqual((await repository.listBySheet(SHEET)).map((a) => a.id), ['p2']);

  await repository.clearSheet(SHEET);
  assert.deepEqual(await repository.listBySheet(SHEET), []);
});

check('a markup kind from a newer build is skipped, not fatal', async () => {
  const server = fakeGoServer();
  const { repository } = connect(server);
  await repository.save(pin('p1'));
  server.annotations.set('h1', { ...server.annotations.get('p1'), id: 'h1', kind: 'hologram' });

  assert.deepEqual((await repository.listBySheet(SHEET)).map((a) => a.id), ['p1']);
});

// =========================================================================
// THE WHOLE EDITING FLOW, AGAINST THE SERVER
// =========================================================================

check('add, edit, move and undo through EditorService land on the server with history', async () => {
  const server = fakeGoServer();
  const { repository, changeLog } = connect(server);
  const editor = new EditorService(repository, { changeLog, ids: new CounterIdGenerator() });

  const original = pin('p1');
  await editor.add(original);
  const assigned = original.withDetail('responsibleCompany', 'Rivera Electric');
  await editor.update(original, assigned, 'Set responsible company of');
  await editor.move(assigned, 10, 10);
  await editor.undo();

  const [stored] = await repository.listBySheet(SHEET);
  assert.equal(stored.details.get('responsibleCompany'), 'Rivera Electric');
  assert.equal(stored.position.x, 120, 'the move was undone on the server too');

  // The undo is history too — EditorService records it as an update, so the
  // log reads as what actually happened to the item, in order.
  const history = await changeLog.listForAnnotation(SHEET, 'p1');
  assert.ok(history.every((record) => record instanceof ChangeRecord));
  assert.deepEqual(history.map((r) => r.intent), ['update', 'move', 'update', 'create'], 'newest first');

  const latest = await changeLog.latestBySheet(SHEET);
  assert.ok(latest instanceof Map);
  assert.equal(latest.get('p1').intent, 'update');
  assert.equal(latest.get('p1').describe(), 'this device edited it');
});

check('a change sent twice — a retry after a dropped connection — is recorded once', async () => {
  const server = fakeGoServer();
  const { changeLog } = connect(server);
  const record = new ChangeRecord({
    id: 'c1',
    annotationId: 'p1',
    sheetId: SHEET,
    intent: 'update',
    actor: Actor.ANONYMOUS,
    at: '2026-10-08T14:00:00.000Z',
    detail: 'Describe',
  });

  await changeLog.record(record);
  await changeLog.record(record);
  assert.equal((await changeLog.listForAnnotation(SHEET, 'p1')).length, 1);
});

// =========================================================================
// EXPORTS AND THE SEAL
// =========================================================================

check('issuing a PDF seals its markups on the server, for every device', async () => {
  const server = fakeGoServer();
  const { repository, exportHistory } = connect(server);
  const ids = new SequentialIds();
  await repository.save(pin('p1'));
  await repository.save(pin('p2'));

  const service = new ExportService(new AnnotationService(repository, ids), new SealingExporter(), exportHistory, ids);
  await service.exportDocument({
    sourceBytes: new ArrayBuffer(8),
    pageCount: 1,
    sheetIdFor: () => SHEET,
    author: 'Verifier',
    documentName: DOCUMENT,
  });

  // A second device asking the same server.
  const elsewhere = new HttpExportHistoryRepository(API, server.fetch);
  assert.deepEqual([...(await elsewhere.sealedIdsForSheet(DOCUMENT, SHEET))].sort(), ['p1', 'p2']);

  const [record] = await elsewhere.listForDocument(DOCUMENT);
  assert.ok(record instanceof ExportRecord);
  assert.equal(record.mode, 'flattened');
  assert.ok(record.seals);
});

check('if the sealed-markups request fails it throws — the lock never fails open', async () => {
  const server = fakeGoServer({ failWith: /^\/api\/exports\/sealed$/ });
  const { exportHistory } = connect(server);

  await assert.rejects(() => exportHistory.sealedIdsForSheet(DOCUMENT, SHEET), /failed: 500/);
});

// =========================================================================
// WHEN THE SERVER IS NOT THERE
// =========================================================================

check('with no server running, the error says so in words a person can act on', async () => {
  const offline = () => Promise.reject(new TypeError('Failed to fetch'));
  const repository = new HttpAnnotationRepository(API, offline);

  await assert.rejects(
    () => repository.listBySheet(SHEET),
    (error) => {
      assert.match(error.message, /Cannot reach the Punch List server at \/api\. Is the backend running\?/);
      assert.equal(error.cause.message, 'Failed to fetch', 'the original error is kept for debugging');
      return true;
    },
  );
});

check('behind a proxy, a stopped backend (502) gets the same plain-words message', async () => {
  const proxyWithNoBackend = async () => new Response(null, { status: 502, statusText: 'Bad Gateway' });
  const repository = new HttpAnnotationRepository(API, proxyWithNoBackend);

  await assert.rejects(
    () => repository.listBySheet(SHEET),
    /The Punch List server at \/api is not responding \(502 Bad Gateway\)\. Is the backend running\?/,
  );
});

check('a server error names the request and the status', async () => {
  const server = fakeGoServer({ failWith: /\/annotations$/ });
  const { repository } = connect(server);

  await assert.rejects(() => repository.listBySheet(SHEET), /^Error: GET \/sheets\/.+\/annotations failed: 500/);
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

console.log(`\n${checks.length - failed}/${checks.length} HTTP repository checks passed.`);
process.exit(failed === 0 ? 0 : 1);
