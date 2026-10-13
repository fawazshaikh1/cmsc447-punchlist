/**
 * Checks the one-time upload of browser-saved work to the server.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * Switching the app to the server must not make anybody's existing markups
 * disappear from view, and must not let an old browser copy overwrite newer
 * work on the server. So:
 *
 *   - the first read of a sheet brings its browser markups, history and seals
 *     with it — and an issued markup is still locked afterwards;
 *   - the server's copy wins, and what was deleted on the server stays deleted;
 *   - it happens once: not again on the next read, not twice when three reads
 *     arrive together, and not marked done if it failed.
 *
 * Run with: npm run verify -- upload
 */
import assert from 'node:assert/strict';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import { ChangeRecord } from '../src/domain/audit/ChangeRecord.js';
import { ExportRecord } from '../src/domain/export/ExportRecord.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { UploadLedger } from '../src/domain/ports/UploadLedger.js';
import {
  BrowserUploadService,
  UploadingAnnotationRepository,
  UploadingChangeLogRepository,
  UploadingExportHistoryRepository,
} from '../src/domain/upload/index.js';
import { InMemoryAnnotationRepository } from '../src/infrastructure/persistence/InMemoryAnnotationRepository.js';
import { InMemoryChangeLogRepository } from '../src/infrastructure/persistence/InMemoryChangeLogRepository.js';
import { InMemoryExportHistoryRepository } from '../src/infrastructure/persistence/InMemoryExportHistoryRepository.js';
import { LocalStorageUploadLedger } from '../src/infrastructure/persistence/LocalStorageUploadLedger.js';

const DOC = 'drawing.pdf';
const SHEET = 'drawing.pdf#0';

class MemoryLedger extends UploadLedger {
  keys = new Set();
  has(key) {
    return this.keys.has(key);
  }
  add(key) {
    this.keys.add(key);
  }
}

/** Counts calls to a store's methods, so "once" can be checked. */
function counting(store) {
  const calls = {};
  const proxy = new Proxy(store, {
    get(target, name) {
      const value = target[name];
      if (typeof value !== 'function') return value;
      return (...args) => {
        calls[name] = (calls[name] ?? 0) + 1;
        return value.apply(target, args);
      };
    },
  });
  // The service checks instanceof; a Proxy of an instance passes.
  return { proxy, calls };
}

function pin(id, label = 'Cracked tile') {
  return new Pin(id, SHEET, new PdfPoint(100, 200), label, PinStatus.OPEN, new Date('2026-10-01T12:00:00Z'));
}

function change(id, annotationId, intent, at) {
  return new ChangeRecord({ id, annotationId, sheetId: SHEET, intent, actor: Actor.ANONYMOUS, at, detail: intent });
}

function stores() {
  return {
    annotations: new InMemoryAnnotationRepository(),
    changeLog: new InMemoryChangeLogRepository(),
    exports: new InMemoryExportHistoryRepository(),
  };
}

/** A browser with saved work, a server, and the decorated stores the app would use. */
async function setUp({ seedLocal = true, server = stores(), ledger = new MemoryLedger() } = {}) {
  const local = stores();
  if (seedLocal) {
    await local.annotations.save(pin('a', 'Outlet cover missing').withDetail('trade', 'Electrical'));
    await local.annotations.save(pin('b', 'Door binds'));
    await local.changeLog.record(change('c1', 'a', 'create', '2026-10-01T12:00:00.000Z'));
    await local.changeLog.record(change('c2', 'a', 'update', '2026-10-01T12:05:00.000Z'));
    await local.changeLog.record(change('c3', 'b', 'create', '2026-10-01T12:06:00.000Z'));
    // A markup deleted in this browser: only its history remains.
    await local.changeLog.record(change('c4', 'gone', 'create', '2026-10-01T12:07:00.000Z'));
    await local.changeLog.record(change('c5', 'gone', 'delete', '2026-10-01T12:08:00.000Z'));
    await local.exports.record(
      new ExportRecord({
        id: 'e1',
        documentName: DOC,
        mode: ExportRecord.MODE.FLATTENED,
        exportedAt: '2026-10-02T09:00:00.000Z',
        exportedBy: 'this device',
        annotationIdsBySheet: { [SHEET]: ['b'] },
      }),
    );
  }

  const localAnnotations = counting(local.annotations);
  const uploads = new BrowserUploadService({
    local: { annotations: localAnnotations.proxy, changeLog: local.changeLog, exports: local.exports },
    server,
    ledger,
  });

  return {
    local,
    server,
    ledger,
    uploads,
    localReads: localAnnotations.calls,
    app: {
      annotations: new UploadingAnnotationRepository(server.annotations, uploads),
      changeLog: new UploadingChangeLogRepository(server.changeLog, uploads),
      exports: new UploadingExportHistoryRepository(server.exports, uploads),
    },
  };
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// NOTHING IS LOST
// =========================================================================

check('the first read of a sheet brings its browser markups to the server, details and all', async () => {
  const { app, server } = await setUp();

  const loaded = await app.annotations.listBySheet(SHEET);
  assert.deepEqual(loaded.map((a) => a.id).sort(), ['a', 'b']);
  assert.equal(loaded.find((a) => a.id === 'a').details.get('trade'), 'Electrical');
  assert.equal((await server.annotations.listBySheet(SHEET)).length, 2, 'really on the server, not just returned');
});

check('history comes too — including a markup deleted in this browser', async () => {
  const { app, server } = await setUp();
  await app.annotations.listBySheet(SHEET);

  assert.deepEqual((await server.changeLog.listForAnnotation(SHEET, 'a')).map((r) => r.intent), ['update', 'create']);
  assert.deepEqual((await server.changeLog.listForAnnotation(SHEET, 'gone')).map((r) => r.intent), ['delete', 'create']);
});

check('a markup issued from this browser is still locked once on the server', async () => {
  const { app } = await setUp();

  const sealed = await app.exports.sealedIdsForSheet(DOC, SHEET);
  assert.deepEqual([...sealed], ['b']);
});

check('the browser copy is kept as a backup', async () => {
  const { app, local } = await setUp();
  await app.annotations.listBySheet(SHEET);

  assert.equal((await local.annotations.listBySheet(SHEET)).length, 2);
});

// =========================================================================
// NEWER WORK IS NOT OVERWRITTEN
// =========================================================================

check('the server copy wins when both have the same markup', async () => {
  const server = stores();
  await server.annotations.save(pin('a', 'Outlet cover missing — fixed on the server'));
  const { app } = await setUp({ server });

  const [a] = (await app.annotations.listBySheet(SHEET)).filter((x) => x.id === 'a');
  assert.equal(a.label, 'Outlet cover missing — fixed on the server');
});

check('a markup deleted on the server is not brought back from a browser', async () => {
  const server = stores();
  await server.changeLog.record(change('s1', 'b', 'delete', '2026-10-05T10:00:00.000Z'));
  const { app } = await setUp({ server });

  assert.deepEqual((await app.annotations.listBySheet(SHEET)).map((x) => x.id), ['a']);
});

// =========================================================================
// ONCE
// =========================================================================

check('a second read does not upload again', async () => {
  const { app, localReads } = await setUp();
  await app.annotations.listBySheet(SHEET);
  await app.annotations.listBySheet(SHEET);
  await app.changeLog.latestBySheet(SHEET);

  assert.equal(localReads.listBySheet, 1, 'browser storage read once');
});

check('three reads at once — markups, history, seals — share one upload', async () => {
  const { app, server, localReads } = await setUp();
  await Promise.all([
    app.annotations.listBySheet(SHEET),
    app.changeLog.latestBySheet(SHEET),
    app.exports.sealedIdsForSheet(DOC, SHEET),
  ]);

  assert.equal(localReads.listBySheet, 1);
  assert.equal((await server.annotations.listBySheet(SHEET)).length, 2, 'no duplicates');
});

check('a later session skips it too — the ledger remembers', async () => {
  const ledger = new MemoryLedger();
  await (await setUp({ ledger })).app.annotations.listBySheet(SHEET);

  const nextSession = await setUp({ ledger });
  await nextSession.app.annotations.listBySheet(SHEET);
  assert.equal(nextSession.localReads.listBySheet, undefined, 'not even read');
});

check('a failed upload is not marked done, and the next read tries again', async () => {
  const server = stores();
  const realSave = server.annotations.save.bind(server.annotations);
  let failures = 1;
  server.annotations.save = async (annotation) => {
    if (failures-- > 0) throw new Error('server down');
    return realSave(annotation);
  };
  const { app, ledger } = await setUp({ server });

  await assert.rejects(() => app.annotations.listBySheet(SHEET), /server down/);
  assert.equal(ledger.has(`sheet:${SHEET}`), false);

  assert.equal((await app.annotations.listBySheet(SHEET)).length, 2, 'second attempt completes it');
  assert.equal(ledger.has(`sheet:${SHEET}`), true);
});

check('a sheet with nothing saved in this browser is marked done without touching the server', async () => {
  const server = stores();
  const serverReads = counting(server.annotations);
  const { app, ledger } = await setUp({
    seedLocal: false,
    server: { ...server, annotations: serverReads.proxy },
  });

  // Decorator → upload (nothing local) → inner list. Exactly one server read,
  // the one the app asked for.
  await app.annotations.listBySheet(SHEET);
  assert.equal(serverReads.calls.listBySheet, 1);
  assert.equal(ledger.has(`sheet:${SHEET}`), true);
});

// =========================================================================
// THE LEDGER IN LOCAL STORAGE
// =========================================================================

check('the local-storage ledger survives a reload and shrugs off a damaged entry', () => {
  const memory = new Map();
  const storage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
  };

  new LocalStorageUploadLedger(storage).add('sheet:x');
  assert.equal(new LocalStorageUploadLedger(storage).has('sheet:x'), true, 'remembered across instances');

  memory.set('punchlist.uploadedToServer', '{not json');
  assert.equal(new LocalStorageUploadLedger(storage).has('sheet:x'), false, 'damaged: start empty, upload again');

  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const ledger = new LocalStorageUploadLedger(broken);
  ledger.add('sheet:y');
  assert.equal(ledger.has('sheet:y'), true, 'kept in memory when storage refuses');
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

console.log(`\n${checks.length - failed}/${checks.length} browser upload checks passed.`);
process.exit(failed === 0 ? 0 : 1);
