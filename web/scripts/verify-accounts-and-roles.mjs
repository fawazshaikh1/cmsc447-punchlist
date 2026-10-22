/**
 * Checks accounts, projects and roles in the browser (SCRUM-42, 43, 44, 46, 47).
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * 1. EVERY SHEET IS IN A PROJECT. Inside a project a sheet's id carries the
 *    project, so two projects with the same drawing never share markups — and
 *    the browser names sheets exactly the way backend/access.go reads them.
 * 2. THE INTERFACE OFFERS WHAT THE ROLE ALLOWS, AND NO MORE. A collaborator
 *    gets Select and Photo, no Delete, no Issue PDF. The rules live in one
 *    table (RoleEditPolicy) that mirrors the server's.
 * 3. THE SERVER'S ANSWERS REACH THE PERSON. A refusal arrives as the same
 *    "not permitted" error the policy throws, with the server's own sentence;
 *    every request carries the anti-forgery header the server demands.
 * 4. WHO IS WORKING IS THE PERSON ON THIS PROJECT, and a slow answer about a
 *    project they have left never overwrites the one they are in.
 * 5. WORK SAVED IN THIS BROWSER BEFORE PROJECTS EXISTED still reaches the
 *    server — once, into the first project that opens the drawing — and a
 *    role that may not upload it does not stop that person reading the sheet.
 *
 * The server side of all this is tested in Go against Postgres:
 *   cd backend && go test ./...
 *
 * Run with: npm run verify -- accounts
 */
import assert from 'node:assert/strict';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import '../src/domain/details/index.js';
import '../src/domain/tools/index.js';
import { ChangeRecord } from '../src/domain/audit/ChangeRecord.js';
import { ExportRecord } from '../src/domain/export/ExportRecord.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { Account } from '../src/domain/identity/Account.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { StaticIdentityProvider } from '../src/domain/identity/StaticIdentityProvider.js';
import { CounterIdGenerator } from '../src/domain/identity/CounterIdGenerator.js';
import {
  CompositeEditPolicy,
  EditNotPermittedError,
  EditPolicy,
  RoleEditPolicy,
  SealedByExportPolicy,
} from '../src/domain/policy/index.js';
import { Member, Project, ProjectRole, SheetScope } from '../src/domain/projects/index.js';
import { UploadLedger } from '../src/domain/ports/UploadLedger.js';
import { EditorService } from '../src/domain/services/EditorService.js';
import { ToolRegistry } from '../src/domain/tools/ToolRegistry.js';
import { BrowserUploadService, UploadingAnnotationRepository, UploadingChangeLogRepository, UploadingExportHistoryRepository } from '../src/domain/upload/index.js';
import { HttpAccountRepository } from '../src/infrastructure/auth/HttpAccountRepository.js';
import { HttpProjectRepository } from '../src/infrastructure/auth/HttpProjectRepository.js';
import { SessionIdentityProvider } from '../src/infrastructure/identity/SessionIdentityProvider.js';
import { HttpJsonClient } from '../src/infrastructure/persistence/HttpJsonClient.js';
import { InMemoryAnnotationRepository } from '../src/infrastructure/persistence/InMemoryAnnotationRepository.js';
import { InMemoryChangeLogRepository } from '../src/infrastructure/persistence/InMemoryChangeLogRepository.js';
import { InMemoryExportHistoryRepository } from '../src/infrastructure/persistence/InMemoryExportHistoryRepository.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const actor = (role, id = `u-${role}`) => new Actor({ id, displayName: `Person ${role}`, company: 'Co', role });

/** An editor working as `who`, with roles and seals switched on as in server mode. */
function editorFor(who, sealed = []) {
  return new EditorService(new InMemoryAnnotationRepository(), {
    identity: new StaticIdentityProvider(who),
    policy: new CompositeEditPolicy([new SealedByExportPolicy(() => new Set(sealed)), new RoleEditPolicy()]),
    changeLog: new InMemoryChangeLogRepository(),
    ids: new CounterIdGenerator(),
  });
}

const SHEET = 'p7:A-101.pdf#0';
const pin = (id, sheetId = SHEET) =>
  new Pin(id, sheetId, new PdfPoint(100, 200), 'Cracked tile', PinStatus.OPEN, new Date('2026-10-01T12:00:00Z'));

/**
 * A fetch that answers from a table of handlers and remembers what it was
 * asked. Each handler gets the URL and init and returns a Response.
 */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    return handler(url, init);
  };
  return { fn, calls };
}

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });

// =========================================================================
// PART 1 — every sheet is in a project
// =========================================================================

check('inside a project a sheet id carries the project; browser mode leaves it alone', () => {
  assert.equal(SheetScope.forProject(12).qualify('A-101.pdf#0'), 'p12:A-101.pdf#0');
  assert.equal(SheetScope.NONE.qualify('A-101.pdf#0'), 'A-101.pdf#0');
  assert.notEqual(
    SheetScope.forProject(1).qualify('A-101.pdf#0'),
    SheetScope.forProject(2).qualify('A-101.pdf#0'),
    'two projects with the same drawing never share a sheet',
  );
});

check('the bare id and the project come back out — the same reading as the server', () => {
  assert.equal(SheetScope.localIdOf('p12:A-101.pdf#0'), 'A-101.pdf#0');
  assert.equal(SheetScope.localIdOf('A-101.pdf#0'), 'A-101.pdf#0');
  // A file whose own name looks like a prefix is only unwrapped once.
  assert.equal(SheetScope.localIdOf('p3:p4:odd.pdf#0'), 'p4:odd.pdf#0');
  assert.equal(SheetScope.projectOf('p12:A.pdf#0'), 12);
  // Exactly the ids backend/access.go refuses are not read as projects here.
  for (const bare of ['A.pdf#0', 'p:A.pdf#0', 'pX:A.pdf#0', 'p0:A.pdf#0', 'p01:A.pdf#0', 'p5:']) {
    assert.equal(SheetScope.projectOf(bare), null, bare);
  }
});

check('a project id must be a positive whole number', () => {
  for (const bad of [0, -1, 1.5, '3', NaN]) assert.throws(() => SheetScope.forProject(bad), TypeError);
});

check('projects, members and accounts refuse what the server would never send', () => {
  const p = Project.fromJSON({ id: 3, name: 'Library', role: 'admin' });
  assert.equal(p.canManagePeople, true);
  assert.equal(p.sheetScope.qualify('x.pdf#0'), 'p3:x.pdf#0');
  assert.equal(new Project({ id: 3, name: 'Library', role: 'collaborator' }).canManagePeople, false);
  assert.throws(() => new Project({ id: 3, name: 'X', role: 'owner' }), /Unknown project role/);
  assert.throws(() => new Project({ id: 0, name: 'X', role: 'admin' }));
  assert.throws(() => new Project({ id: 3, name: '  ', role: 'admin' }));

  const m = Member.fromJSON({ userId: '9', email: 'jo@x.test', displayName: 'Jo', company: 'Apex', role: 'power_collaborator' });
  assert.equal(String(m), 'Jo (Apex)');
  assert.throws(() => new Member({ userId: '9', email: 'a@b', displayName: 'A', role: 'boss' }));

  const a = Account.fromJSON({ id: '9', email: 'jo@x.test', displayName: 'Jo', company: 'Apex', title: 'Foreman' });
  assert.equal(String(a), 'Jo (Apex)');
  assert.throws(() => new Account({ id: '', email: 'a@b', displayName: 'A' }));
});

// =========================================================================
// PART 2 — the interface offers what the role allows
// =========================================================================

check('admin and power collaborator may do everything to a markup, and issue', () => {
  for (const role of [ProjectRole.ADMIN, ProjectRole.POWER_COLLABORATOR]) {
    const editor = editorFor(actor(role));
    for (const intent of Object.values(EditPolicy.INTENT)) {
      assert.equal(editor.canEdit(pin('a'), intent).allowed, true, `${role} ${intent}`);
    }
    assert.equal(editor.canCreate('pin').allowed, true);
    assert.equal(editor.canIssue().allowed, true);
  }
});

check('a collaborator adds photos and comments, and nothing else', () => {
  const editor = editorFor(actor(ProjectRole.COLLABORATOR));
  assert.equal(editor.canCreate('photo').allowed, true);
  assert.equal(editor.canEdit(pin('a'), EditPolicy.INTENT.COMMENT).allowed, true);

  for (const kind of ['pin', 'rectangle', 'cloud', 'arrow', 'ink', 'text']) {
    assert.equal(editor.canCreate(kind).code, 'role', `create ${kind}`);
  }
  for (const intent of ['move', 'resize', 'update', 'delete', 'status']) {
    assert.equal(editor.canEdit(pin('a'), intent).code, 'role', intent);
  }
  assert.equal(editor.canIssue().code, 'role', 'issuing locks markups — not for collaborators');
  assert.equal(editor.canClearSheet().code, 'role', 'no Clear sheet for them either');
  assert.equal(editorFor(actor(ProjectRole.POWER_COLLABORATOR)).canClearSheet().allowed, true);
});

check('the tool rail for a collaborator is Select and Photo', () => {
  const editor = editorFor(actor(ProjectRole.COLLABORATOR));
  const offered = ToolRegistry.all()
    .filter((tool) => tool.isSelection() || editor.canCreate(tool.createsKind()).allowed)
    .map((tool) => tool.getId());
  assert.deepEqual(offered, ['select', 'photo']);

  const admin = editorFor(actor(ProjectRole.ADMIN));
  assert.equal(
    ToolRegistry.all().filter((t) => t.isSelection() || admin.canCreate(t.createsKind()).allowed).length,
    ToolRegistry.all().length,
    'an admin sees every tool',
  );
});

check('every drawing tool says what it creates; selection creates nothing', () => {
  for (const tool of ToolRegistry.all()) {
    if (tool.isSelection()) assert.equal(tool.createsKind(), null);
    else assert.equal(typeof tool.createsKind(), 'string', tool.getId());
  }
});

check('nobody signed in, or a role nobody has heard of, may change nothing', () => {
  for (const who of [Actor.ANONYMOUS, actor('owner')]) {
    const editor = editorFor(who);
    assert.equal(editor.canCreate('photo').allowed, false);
    assert.equal(editor.canIssue().allowed, false);
    assert.equal(editor.canEdit(pin('a'), 'update').allowed, false);
  }
  assert.equal(editorFor(Actor.ANONYMOUS).canCreate('photo').code, 'unauthenticated');
});

check('an issued markup stays locked even for an admin; asking about a new one is safe', () => {
  const editor = editorFor(actor(ProjectRole.ADMIN), ['a']);
  assert.equal(editor.canEdit(pin('a'), 'update').code, 'sealed');
  // The seal policy is asked with no annotation when creating — it must not throw.
  assert.equal(editor.canCreate('pin').allowed, true);
  assert.equal(editor.canIssue().allowed, true);
});

check('a refused write is still refused if the interface is bypassed', async () => {
  const editor = editorFor(actor(ProjectRole.COLLABORATOR));
  await assert.rejects(() => editor.add(pin('z')), (error) => error instanceof EditNotPermittedError && error.code === 'role');
});

// =========================================================================
// PART 3 — the server's answers reach the person
// =========================================================================

check('every request carries the anti-forgery header the server demands', async () => {
  const { fn, calls } = fakeFetch(() => json(200, []));
  const http = new HttpJsonClient('/api', fn);
  await http.getJson('/projects');
  await http.sendJson('POST', '/projects', { name: 'x' });
  await http.request('/annotations/a', { method: 'DELETE', headers: { 'X-Other': 'kept' } });
  for (const call of calls) assert.equal(call.headers['X-Punchlist-Request'], '1', `${call.method} ${call.url}`);
  assert.equal(calls[2].headers['X-Other'], 'kept', 'the caller’s own headers survive');
});

check('a refusal arrives as "not permitted", in the server’s own words', async () => {
  const sentence = 'Your role on this project does not allow that change.';
  const { fn } = fakeFetch(() => json(403, { error: sentence }));
  const http = new HttpJsonClient('/api', fn);
  await assert.rejects(
    () => http.request('/annotations/a', { method: 'PUT' }),
    (error) => error instanceof EditNotPermittedError && error.message === sentence && error.status === 403,
  );
});

check('other errors keep the server’s sentence and their status; plain ones read as before', async () => {
  const http401 = new HttpJsonClient('/api', fakeFetch(() => json(401, { error: 'Sign in to continue.' })).fn);
  await assert.rejects(() => http401.getJson('/projects'), (e) => e.message === 'Sign in to continue.' && e.status === 401);

  const plain = new HttpJsonClient('/api', fakeFetch(() => new Response('database error', { status: 500, statusText: 'Internal Server Error' })).fn);
  await assert.rejects(() => plain.getJson('/projects'), /^Error: GET \/projects failed: 500 Internal Server Error$/);
});

check('accounts: signed out is an answer, not an error — but a dead server is an error', async () => {
  const out = new HttpAccountRepository('/api', fakeFetch(() => json(200, null)).fn);
  assert.equal(await out.current(), null, '200 null — no error in the console on every visit');
  const older = new HttpAccountRepository('/api', fakeFetch(() => json(401, { error: 'Sign in to continue.' })).fn);
  assert.equal(await older.current(), null, 'a 401 still reads as signed out');

  const down = new HttpAccountRepository('/api', fakeFetch(() => new Response(null, { status: 502, statusText: 'Bad Gateway' })).fn);
  await assert.rejects(() => down.current(), /not responding \(502 Bad Gateway\)/);
});

check('accounts: sign in, register and sign out send what the server expects', async () => {
  const me = { id: '4', email: 'jo@x.test', displayName: 'Jo', company: 'Apex', title: '' };
  const { fn, calls } = fakeFetch((url) => (url.endsWith('/logout') ? json(204) : json(url.endsWith('/register') ? 201 : 200, me)));
  const accounts = new HttpAccountRepository('/api', fn);

  assert.equal((await accounts.signIn('jo@x.test', 'pass phrase here!')).displayName, 'Jo');
  await accounts.register({ email: 'jo@x.test', password: 'pass phrase here!', displayName: 'Jo', company: 'Apex' });
  await accounts.signOut();

  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST /api/auth/login', 'POST /api/auth/register', 'POST /api/auth/logout']);
  assert.deepEqual(calls[0].body, { email: 'jo@x.test', password: 'pass phrase here!' });
  assert.deepEqual(calls[1].body, { email: 'jo@x.test', password: 'pass phrase here!', displayName: 'Jo', company: 'Apex', title: '' });
});

check('projects: list, create and manage members at the right addresses', async () => {
  const member = { userId: '8', email: 'sam@x.test', displayName: 'Sam', company: 'Co', title: '', role: 'collaborator' };
  const { fn, calls } = fakeFetch((url, init) => {
    if (url === '/api/projects' && !init.method) return json(200, [{ id: 3, name: 'Library', role: 'admin' }]);
    if (url === '/api/projects') return json(201, { id: 4, name: 'Gym', role: 'admin' });
    if (init.method === 'DELETE') return json(204);
    if (init.method === 'PUT') return json(200, member);
    return json(200, [member]);
  });
  const projects = new HttpProjectRepository('/api', fn);

  const [library] = await projects.list();
  assert.ok(library instanceof Project && library.role === 'admin');
  assert.equal((await projects.create('Gym')).id, 4);
  assert.equal((await projects.members(3))[0].displayName, 'Sam');
  assert.equal((await projects.setMember(3, 'sam@x.test', 'collaborator')).role, 'collaborator');
  await projects.removeMember(3, '8');

  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET /api/projects',
    'POST /api/projects',
    'GET /api/projects/3/members',
    'PUT /api/projects/3/members',
    'DELETE /api/projects/3/members/8',
  ]);
  assert.deepEqual(calls[3].body, { email: 'sam@x.test', role: 'collaborator' });
});

// =========================================================================
// PART 4 — who is working is the person on THIS project
// =========================================================================

check('the actor carries the role on the open project, and asks again on switching', async () => {
  const roles = { 3: 'admin', 4: 'collaborator' };
  const { fn, calls } = fakeFetch((url) => {
    const project = new URL(url, 'http://x').searchParams.get('project');
    return json(200, { id: '4', displayName: 'Jo', company: 'Apex', role: roles[project] ?? '' });
  });
  const identity = new SessionIdentityProvider('/api', fn);
  assert.equal(identity.current().isAnonymous, true, 'nobody until asked');

  assert.equal((await identity.useProject(3)).role, 'admin');
  assert.equal((await identity.useProject(4)).role, 'collaborator');
  assert.equal(identity.current().toString(), 'Jo (Apex)');
  assert.deepEqual(calls.map((c) => c.url), ['/api/session?project=3', '/api/session?project=4']);

  identity.clear();
  assert.equal(identity.current().isAnonymous, true, 'signing out forgets them');
});

check('a slow answer about the previous project never overwrites the current one', async () => {
  let releaseSlow;
  const fn = async (url) => {
    if (url.endsWith('project=3')) {
      await new Promise((resolve) => (releaseSlow = resolve));
      return json(200, { id: '4', displayName: 'Jo', role: 'admin' });
    }
    return json(200, { id: '4', displayName: 'Jo', role: 'collaborator' });
  };
  const identity = new SessionIdentityProvider('/api', fn);
  const slow = identity.useProject(3);
  await identity.useProject(4);
  releaseSlow();
  await slow;
  assert.equal(identity.current().role, 'collaborator');
});

check('when the server cannot say who you are, you are nobody — permissions fail closed', async () => {
  const offline = new SessionIdentityProvider('/api', async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal((await offline.useProject(3)).isAnonymous, true);
  const expired = new SessionIdentityProvider('/api', async () => json(401, { error: 'Sign in to continue.' }));
  assert.equal((await expired.useProject(3)).isAnonymous, true);
});

// =========================================================================
// PART 5 — work saved in this browser before projects existed
// =========================================================================

class MemoryLedger extends UploadLedger {
  keys = new Set();
  has(key) {
    return this.keys.has(key);
  }
  add(key) {
    this.keys.add(key);
  }
}

const stores = () => ({
  annotations: new InMemoryAnnotationRepository(),
  changeLog: new InMemoryChangeLogRepository(),
  exports: new InMemoryExportHistoryRepository(),
});

async function browserWithOldWork() {
  const local = stores();
  await local.annotations.save(pin('a', 'A-101.pdf#0'));
  await local.changeLog.record(
    new ChangeRecord({ id: 'c1', annotationId: 'a', sheetId: 'A-101.pdf#0', intent: 'create', actor: Actor.ANONYMOUS, at: '2026-10-01T12:00:00.000Z', detail: 'Added' }),
  );
  await local.exports.record(
    new ExportRecord({
      id: 'e1', documentName: 'A-101.pdf', mode: ExportRecord.MODE.FLATTENED,
      exportedAt: '2026-10-02T09:00:00.000Z', exportedBy: 'this device',
      annotationIdsBySheet: { 'A-101.pdf#0': ['a'] },
    }),
  );
  return local;
}

function app(uploads, server) {
  return {
    annotations: new UploadingAnnotationRepository(server.annotations, uploads),
    changeLog: new UploadingChangeLogRepository(server.changeLog, uploads),
    exports: new UploadingExportHistoryRepository(server.exports, uploads),
  };
}

check('opening the drawing in a project brings the browser’s markups, history and seals into it', async () => {
  const local = await browserWithOldWork();
  const server = stores();
  const ledger = new MemoryLedger();
  const uploads = new BrowserUploadService({ local, server, ledger });
  const project = app(uploads, server);

  const markups = await project.annotations.listBySheet(SHEET);
  assert.deepEqual(markups.map((a) => [a.id, a.sheetId]), [['a', SHEET]], 'filed under the project’s sheet');
  const history = await project.changeLog.listForAnnotation(SHEET, 'a');
  assert.deepEqual(history.map((c) => c.sheetId), [SHEET]);
  assert.deepEqual([...(await project.exports.sealedIdsForSheet('A-101.pdf', SHEET))], ['a'], 'still issued, still locked');

  // ...and the same drawing opened in a second project does not get a copy.
  const other = app(uploads, server);
  assert.deepEqual(await other.annotations.listBySheet('p8:A-101.pdf#0'), []);
  assert.ok(ledger.has('sheet:A-101.pdf#0'), 'remembered by the bare id');
});

check('a role that may not upload them can still read the sheet — and a later admin uploads them', async () => {
  const local = await browserWithOldWork();
  const refused = stores();
  const refuse = async () => {
    const { EditDecision } = await import('../src/domain/policy/EditDecision.js');
    throw new EditNotPermittedError(EditDecision.deny('Your role on this project does not allow that change.', 'server'));
  };
  refused.annotations.save = refuse;
  refused.exports.record = refuse;
  const ledger = new MemoryLedger();
  const asCollaborator = app(new BrowserUploadService({ local, server: refused, ledger }), refused);

  assert.deepEqual(await asCollaborator.annotations.listBySheet(SHEET), [], 'reads go ahead');
  assert.deepEqual([...(await asCollaborator.exports.sealedIdsForSheet('A-101.pdf', SHEET))], []);
  assert.equal(ledger.has('sheet:A-101.pdf#0'), false, 'not marked done — someone allowed to will upload it');
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

console.log(`\n${checks.length - failed}/${checks.length} account and role checks passed.`);
process.exit(failed === 0 ? 0 : 1);
