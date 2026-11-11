/**
 * Checks comments and replies, sheet bookmarks and finding a sheet by its
 * number (spec 7).
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. COMMENTS READ AS THREADS: oldest first, a reply under the comment it
 *    answers, a reply to a reply under the same thread (one level, as in
 *    Bluebeam), and a reply whose comment is missing shown on its own rather
 *    than lost.
 * 2. AN ISSUED TASK CAN STILL BE DISCUSSED: the seal refuses every change to
 *    the item, but not a comment on it — the conversation goes on after
 *    handover.
 * 3. A SHEET IS FOUND BY ITS NUMBER, however it is typed: "a201", "A 201" and
 *    "A-201" all find A-201, and its title finds it too.
 * 4. THE ADAPTERS speak the server's language: a comment is a change record
 *    with intent "comment", a bookmark a starred sheet id, escaped in paths.
 *
 * Run with: npm run verify -- comments-bookmarks
 */
import assert from 'node:assert/strict';

import '../src/domain/annotations/index.js';
import { Comment, threadsOf } from '../src/domain/comments/index.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { EditPolicy, SealedByExportPolicy } from '../src/domain/policy/index.js';
import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { searchSheets } from '../src/domain/sheets/index.js';
import { HttpBookmarkRepository } from '../src/infrastructure/bookmarks/HttpBookmarkRepository.js';
import { HttpCommentRepository } from '../src/infrastructure/comments/HttpCommentRepository.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const SHEET = 'p7:A.pdf#0';
const casey = new Actor({ id: '3', displayName: 'Casey Collab', company: 'Metro Drywall', role: 'collaborator' });
const said = (id, at, replyTo = '') =>
  new Comment({ id, annotationId: 'pin-1', sheetId: SHEET, text: `Comment ${id}`, author: casey, at, replyTo });

// =========================================================================
// 1. THREADS
// =========================================================================

check('comments become threads: oldest first, replies under what they answer', () => {
  const threads = threadsOf([
    said('b', '2026-11-10T10:05:00Z', 'a'),
    said('c', '2026-11-10T10:10:00Z'),
    said('a', '2026-11-10T10:00:00Z'),
  ]);
  assert.deepEqual(
    threads.map((thread) => [thread.comment.id, thread.replies.map((reply) => reply.id)]),
    [
      ['a', ['b']],
      ['c', []],
    ],
  );
});

check('a reply to a reply stays in the same thread, one level deep', () => {
  const threads = threadsOf([
    said('a', '2026-11-10T10:00:00Z'),
    said('b', '2026-11-10T10:05:00Z', 'a'),
    said('c', '2026-11-10T10:06:00Z', 'b'),
  ]);
  assert.deepEqual(threads.map((thread) => [thread.comment.id, thread.replies.map((reply) => reply.id)]), [['a', ['b', 'c']]]);
});

check('a reply whose comment is missing is shown on its own, not lost', () => {
  const threads = threadsOf([said('b', '2026-11-10T10:05:00Z', 'gone')]);
  assert.deepEqual(threads.map((thread) => thread.comment.id), ['b']);
});

// =========================================================================
// 2. ISSUED ITEMS
// =========================================================================

check('an issued item refuses every change but a comment', () => {
  const pin = new Pin('pin-1', SHEET, new PdfPoint(1, 1), 'Leak', PinStatus.OPEN, new Date('2026-11-01T00:00:00Z'));
  const policy = new SealedByExportPolicy(() => new Set(['pin-1']));
  assert.equal(policy.check({ annotation: pin, intent: EditPolicy.INTENT.COMMENT }).allowed, true);
  assert.equal(policy.check({ annotation: pin, intent: EditPolicy.INTENT.UPDATE }).denied, true);
  assert.equal(policy.check({ annotation: pin, intent: EditPolicy.INTENT.STATUS }).denied, true);
});

// =========================================================================
// 3. FINDING A SHEET
// =========================================================================

const sheets = [
  { documentName: 'A.pdf', pageIndex: 0, number: 'A-101', title: 'LEVEL 1 FLOOR PLAN' },
  { documentName: 'A.pdf', pageIndex: 2, number: 'A-201', title: 'EXTERIOR ELEVATIONS' },
  { documentName: 'B.pdf', pageIndex: 0, number: 'A-202', title: 'BUILDING SECTIONS' },
  { documentName: 'B.pdf', pageIndex: 1, number: 'S-201', title: 'FOUNDATION PLAN' },
];
const found = (query) => searchSheets(sheets, query).map((sheet) => sheet.number);

check('a sheet is found by its number however it is typed, exact match first', () => {
  assert.deepEqual(found('a201'), ['A-201']);
  assert.deepEqual(found('A 201'), ['A-201']);
  assert.deepEqual(found('A-20'), ['A-201', 'A-202']);
  assert.deepEqual(found('201'), ['A-201', 'S-201']);
});

check('a sheet is found by words of its title, and nothing is found by nothing', () => {
  assert.deepEqual(found('elevations'), ['A-201']);
  assert.deepEqual(found('floor plan'), ['A-101']);
  assert.deepEqual(found('   '), []);
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

check('the comments adapter posts a comment as a change record and reads only comments back', async () => {
  const actor = casey.toJSON();
  const server = fakeServer((method, path) => {
    if (method === 'POST') return undefined;
    if (path.endsWith('/comments/counts')) return { 'pin 1': 2 };
    return [
      { id: 'r', annotationId: 'pin 1', sheetId: SHEET, intent: 'comment', actor, at: '2026-11-10T10:05:00Z', detail: 'North.', replyTo: 'q' },
      { id: 'e', annotationId: 'pin 1', sheetId: SHEET, intent: 'update', actor, at: '2026-11-10T10:01:00Z', detail: 'Set status of' },
      { id: 'q', annotationId: 'pin 1', sheetId: SHEET, intent: 'comment', actor, at: '2026-11-10T10:00:00Z', detail: 'Which door?' },
    ];
  });
  const repo = new HttpCommentRepository('/api', server.fetchFn, () => 'new-id');

  await repo.post({ sheetId: SHEET, annotationId: 'pin 1', text: '  Which door?  ', replyTo: '' });
  const [posted] = server.requests;
  assert.equal(posted.path, '/api/sheets/p7%3AA.pdf%230/changes');
  assert.deepEqual(
    { id: posted.body.id, intent: posted.body.intent, detail: posted.body.detail, annotationId: posted.body.annotationId },
    { id: 'new-id', intent: 'comment', detail: 'Which door?', annotationId: 'pin 1' },
  );
  assert.equal('replyTo' in posted.body, false, 'a comment that answers nothing carries no replyTo');

  const list = await repo.listFor('pin 1');
  assert.deepEqual(list.map((comment) => [comment.id, comment.replyTo, comment.text]), [
    ['r', 'q', 'North.'],
    ['q', '', 'Which door?'],
  ]);
  assert.equal(String(list[0].author), 'Casey Collab (Metro Drywall)');
  assert.equal(server.requests[1].path, '/api/annotations/pin%201/changes');

  assert.equal((await repo.counts(7)).get('pin 1'), 2);
});

check('the bookmarks adapter lists, stars and unstars sheets by escaped id', async () => {
  const server = fakeServer((method) => (method === 'GET' ? [{ sheetId: SHEET, createdAt: '2026-11-10T10:00:00Z' }] : undefined));
  const repo = new HttpBookmarkRepository('/api', server.fetchFn);
  assert.deepEqual(await repo.list(7), [SHEET]);
  await repo.add(7, SHEET);
  await repo.remove(7, SHEET);
  assert.deepEqual(
    server.requests.map(({ method, path }) => `${method} ${path}`),
    ['GET /api/projects/7/bookmarks', 'PUT /api/projects/7/bookmarks/p7%3AA.pdf%230', 'DELETE /api/projects/7/bookmarks/p7%3AA.pdf%230'],
  );
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

console.log(`\n${checks.length - failed}/${checks.length} comments and bookmarks checks passed.`);
process.exit(failed === 0 ? 0 : 1);
