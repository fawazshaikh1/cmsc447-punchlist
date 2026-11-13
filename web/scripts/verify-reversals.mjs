/**
 * Checks reversing the workflow after an accident (spec 8): sending a task
 * back, bringing back what was deleted, and voiding an issue.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. A BACKWARD MOVE IS KNOWN AS ONE: Closed → Ready for review or Open, and
 *    Ready for review → Open, ask why; every forward move, and staying put,
 *    does not. A bulk change asks once, about the tasks that go back.
 * 2. A DELETED ITEM COMES BACK WHOLE: the same id, number, fields and creation
 *    date it had — and is refused, with the reason, when its drawing has gone.
 * 3. A VOIDED ISSUE STAYS IN THE LOG, marked void with who, when and why.
 * 4. THE ADAPTERS speak the server's language: the trash read as markups, an
 *    unreadable row left out rather than failing the list, a void posted with
 *    its reason to the escaped export id.
 *
 * Run with: npm run verify -- reversals
 */
import assert from 'node:assert/strict';

import '../src/domain/annotations/index.js';
import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { DeletedItem, IssueRecord, StatusTransition } from '../src/domain/reversals/index.js';
import { HttpIssueRepository } from '../src/infrastructure/reversals/HttpIssueRepository.js';
import { HttpTrashRepository } from '../src/infrastructure/reversals/HttpTrashRepository.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const { OPEN, READY_FOR_REVIEW: READY, CLOSED } = PinStatus;
const SHEET = 'p7:A.pdf#0';
const pin = (id, status, label = 'Door sticks') =>
  new Pin(id, SHEET, new PdfPoint(10, 20), label, status, new Date('2026-11-01T09:00:00Z'));
const pat = new Actor({ id: '1', displayName: 'Pat Admin', company: 'GC', role: 'admin' });

// =========================================================================
// 1. SENDING A TASK BACK
// =========================================================================

check('only a move towards Open is a send back', () => {
  const backward = [
    [CLOSED, READY],
    [CLOSED, OPEN],
    [READY, OPEN],
  ];
  const notBackward = [
    [OPEN, READY],
    [OPEN, CLOSED],
    [READY, CLOSED],
    [OPEN, OPEN],
    [READY, READY],
    [CLOSED, CLOSED],
  ];
  for (const [from, to] of backward) assert.equal(StatusTransition.isBackward(from, to), true, `${from} → ${to}`);
  for (const [from, to] of notBackward) assert.equal(StatusTransition.isBackward(from, to), false, `${from} → ${to}`);
  assert.equal(StatusTransition.isBackward(undefined, OPEN), false, 'a markup with no status is never sent back');
  assert.equal(StatusTransition.isBackward(CLOSED, 'rejected'), false, 'an unknown status is not a known move');
});

check('a bulk change picks out the tasks that go back, and nothing else', () => {
  const changes = [
    { previous: pin('a', CLOSED), next: pin('a', OPEN) },
    { previous: pin('b', OPEN), next: pin('b', OPEN) },
    { previous: pin('c', READY), next: pin('c', OPEN) },
    { previous: null, next: pin('d', OPEN) },
    { previous: pin('e', CLOSED), next: null },
    { previous: pin('f', OPEN), next: pin('f', OPEN, 'Door sticks badly') },
  ];
  assert.deepEqual(
    StatusTransition.backwardIn(changes).map(({ previous }) => previous.id),
    ['a', 'c'],
  );
});

check('a send back says where it went and why, in words for the history', () => {
  assert.equal(StatusTransition.sendBackLabel(OPEN), 'Send back to Open');
  assert.equal(
    StatusTransition.sendBackComment(CLOSED, READY, '  Paint is still wet.  '),
    'Sent back from Closed to Ready for review: Paint is still wet.',
  );
});

// =========================================================================
// 2. RECENTLY DELETED
// =========================================================================

const trashRow = (overrides = {}) => ({
  ...pin('pin-1', READY).toJSON(),
  deletedAt: '2026-11-10T15:00:00Z',
  deletedBy: pat.toJSON(),
  drawingRemoved: false,
  ...overrides,
});

check('a deleted item comes back with its id, fields and creation date', () => {
  const item = DeletedItem.fromJSON(trashRow());
  assert.equal(item.annotation.id, 'pin-1');
  assert.equal(item.annotation.label, 'Door sticks');
  assert.equal(item.annotation.status, READY);
  assert.equal(item.annotation.createdAt.toISOString(), '2026-11-01T09:00:00.000Z');
  assert.equal(item.deletedAt.toISOString(), '2026-11-10T15:00:00.000Z');
  assert.equal(String(item.deletedBy), 'Pat Admin (GC)');
  assert.equal(item.restoreRefusal(), null);
});

check('an item whose drawing has gone is refused, with the reason', () => {
  const item = DeletedItem.fromJSON(trashRow({ drawingRemoved: true }));
  assert.equal(item.restoreRefusal(), 'Its drawing is no longer in the project.');
});

check('nobody recorded as deleting it reads as unknown, and an unreadable row as nothing', () => {
  assert.equal(DeletedItem.fromJSON(trashRow({ deletedBy: null })).deletedBy, null);
  assert.equal(DeletedItem.fromJSON({ id: 'x', kind: 'no-such-kind', sheetId: SHEET, payload: {} }), null);
});

// =========================================================================
// 3. ISSUE HISTORY
// =========================================================================

check('a voided issue keeps its place in the log, marked with who, when and why', () => {
  const live = IssueRecord.fromJSON({
    id: 'e1',
    documentName: 'A.pdf',
    exportedAt: '2026-11-09T12:00:00Z',
    exportedBy: 'Pat Admin (GC)',
    sealedCount: 4,
    void: null,
  });
  assert.equal(live.isVoid, false);
  assert.equal(live.sealedCount, 4);

  const voided = IssueRecord.fromJSON({
    id: 'e2',
    documentName: 'A.pdf',
    exportedAt: '2026-11-09T12:00:00Z',
    exportedBy: 'Pat Admin (GC)',
    sealedCount: 2,
    void: { by: 'Pat Admin (GC)', at: '2026-11-10T08:00:00Z', reason: 'Wrong drawing set' },
  });
  assert.equal(voided.isVoid, true);
  assert.equal(voided.voidedBy, 'Pat Admin (GC)');
  assert.equal(voided.voidReason, 'Wrong drawing set');
  assert.equal(voided.voidedAt.toISOString(), '2026-11-10T08:00:00.000Z');
});

// =========================================================================
// 4. ADAPTERS
// =========================================================================

function fakeServer(respond) {
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url, 'http://localhost').pathname;
    requests.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const body = respond(method, path);
    return body === undefined
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { requests, fetchFn };
}

check('the trash adapter reads the project trash as items, leaving out what it cannot read', async () => {
  const server = fakeServer(() => [trashRow(), { id: 'odd', kind: 'no-such-kind', sheetId: SHEET, payload: {} }]);
  const items = await new HttpTrashRepository('/api', server.fetchFn).list(7);
  assert.deepEqual(items.map((item) => item.annotation.id), ['pin-1']);
  assert.deepEqual(server.requests.map(({ method, path }) => `${method} ${path}`), ['GET /api/projects/7/trash']);
});

check('the issue adapter lists a project issues and voids one with its reason', async () => {
  const server = fakeServer((method) =>
    method === 'GET'
      ? [{ id: 'e 1', documentName: 'A.pdf', exportedAt: '2026-11-09T12:00:00Z', exportedBy: 'Pat', sealedCount: 1, void: null }]
      : undefined,
  );
  const repo = new HttpIssueRepository('/api', server.fetchFn);
  const [issue] = await repo.list(7);
  assert.equal(issue.id, 'e 1');
  await repo.void('e 1', '  Sent to the wrong sub  ');
  assert.deepEqual(
    server.requests.map(({ method, path }) => `${method} ${path}`),
    ['GET /api/projects/7/issues', 'POST /api/exports/e%201/void'],
  );
  assert.deepEqual(server.requests[1].body, { reason: 'Sent to the wrong sub' });
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

console.log(`\n${checks.length - failed}/${checks.length} reversal checks passed.`);
process.exit(failed === 0 ? 0 : 1);
