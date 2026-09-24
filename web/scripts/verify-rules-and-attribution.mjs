/**
 * Checks the completeness rules and the attribution seam.
 *
 * ===========================================================================
 * WHAT THIS IS REALLY PROVING
 * ===========================================================================
 * Two things, and the second matters more than it looks.
 *
 * 1. A pin cannot be stored without a description. The interface collects one
 *    before the pin exists, but the interface is not the guarantee — this
 *    exercises `EditorService` with no UI at all, which is the path a future
 *    import, sync or bulk tool would take.
 *
 * 2. THE SPRINT 2 SIGN-IN CHANGE IS ONE LINE. The last group signs a user in by
 *    passing a different `IdentityProvider` and nothing else, then asserts that
 *    the change log names them and that `RoleEditPolicy` enforces their role.
 *    If that ever stops working, the "just add the user part later" promise has
 *    been broken and this fails loudly — which is the whole reason it is here
 *    rather than in a comment.
 *
 * Run with: npm run verify:rules
 */
import assert from 'node:assert/strict';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import { Actor } from '../src/domain/identity/Actor.js';
import { StaticIdentityProvider } from '../src/domain/identity/StaticIdentityProvider.js';
import { CounterIdGenerator } from '../src/domain/identity/CounterIdGenerator.js';
import {
  CompositeEditPolicy,
  EditNotPermittedError,
  EditPolicy,
  RoleEditPolicy,
} from '../src/domain/policy/index.js';
import {
  AnnotationIncompleteError,
  AnnotationRule,
  AnnotationRuleRegistry,
  RequiredDescriptionRule,
  RuleViolation,
} from '../src/domain/rules/index.js';
import { EditorService } from '../src/domain/services/EditorService.js';
import { InMemoryAnnotationRepository } from '../src/infrastructure/persistence/InMemoryAnnotationRepository.js';
import { InMemoryChangeLogRepository } from '../src/infrastructure/persistence/InMemoryChangeLogRepository.js';

const SHEET = 'drawing.pdf#0';

function build({ identity = new StaticIdentityProvider(), policy } = {}) {
  const repository = new InMemoryAnnotationRepository();
  const changeLog = new InMemoryChangeLogRepository();

  const editor = new EditorService(repository, {
    identity,
    changeLog,
    policy,
    ids: new CounterIdGenerator(),
  });

  return { repository, changeLog, editor };
}

function pin(id, label = 'Cracked tile at column B4', status = PinStatus.OPEN) {
  return new Pin(id, SHEET, new PdfPoint(100, 200), label, status, new Date('2026-09-18'));
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// =========================================================================
// PART 1 — a pin must say what is wrong with it
// =========================================================================

check('a described pin saves normally', async () => {
  const { editor, repository } = build();
  await editor.add(pin('a', 'Grout missing along east wall'));

  const [stored] = await repository.listBySheet(SHEET);
  assert.equal(stored.label, 'Grout missing along east wall');
});

check('a pin with NO description is refused', async () => {
  const { editor, repository } = build();

  await assert.rejects(
    () => editor.add(pin('a', '')),
    (error) => {
      assert.ok(error instanceof AnnotationIncompleteError);
      assert.deepEqual(error.codes, [RequiredDescriptionRule.CODE]);
      return true;
    },
  );

  assert.deepEqual(await repository.listBySheet(SHEET), [], 'nothing may be stored');
});

check('whitespace is not a description', async () => {
  const { editor } = build();

  // Real whitespace, not escaped literals: spaces, a newline, a tab, and a
  // non-breaking space — the last one is what an iPad autocorrect can leave
  // behind, and it is invisible in every input box.
  for (const blank of ['   ', '\n', '\t  \n', ' ']) {
    await assert.rejects(
      () => editor.add(pin('a', blank)),
      AnnotationIncompleteError,
      `${JSON.stringify(blank)} must not count as a description`,
    );
  }
});

check('a description cannot be deleted once set', async () => {
  const { editor, repository } = build();
  const described = pin('a', 'Cracked tile');
  await editor.add(described);

  await assert.rejects(
    () => editor.update(described, described.withLabel('   '), 'Describe'),
    AnnotationIncompleteError,
  );

  const [stored] = await repository.listBySheet(SHEET);
  assert.equal(stored.label, 'Cracked tile', 'the original must survive a refused edit');
});

check('a pin that was ALREADY blank can still be moved and repaired', async () => {
  // Pins placed before the rule existed. If every update demanded completeness
  // they would be frozen — unable to be moved, and unable to be FIXED, which
  // would be the worst of both.
  const { editor, repository } = build();
  const legacy = pin('legacy', '');
  await repository.save(legacy);

  assert.equal(editor.problemsWith(legacy).length, 1);

  // Moving one is allowed: it does not make anything worse.
  await editor.move(legacy, 10, 10);

  // And the repair path works.
  const [afterMove] = await repository.listBySheet(SHEET);
  await editor.update(afterMove, afterMove.withLabel('Chipped skirting'), 'Describe');

  const [repaired] = await repository.listBySheet(SHEET);
  assert.equal(repaired.label, 'Chipped skirting');
  assert.equal(editor.problemsWith(repaired).length, 0);
});

check('the rule only applies to annotations that HAVE a description', async () => {
  // A rule must never report a problem about a concept its subject lacks.
  const rule = new RequiredDescriptionRule();
  const noLabelConcept = { getKind: () => 'arrow' };

  assert.equal(rule.check(noLabelConcept), null);
});

check('problemsWith is readable by the interface without throwing', async () => {
  const { editor } = build();

  const problems = editor.problemsWith(pin('a', ''));
  assert.equal(problems.length, 1);
  assert.ok(problems[0] instanceof RuleViolation);
  assert.equal(problems[0].field, 'label', 'the panel needs to know which box');
  assert.match(problems[0].message, /description/i);

  assert.deepEqual(editor.problemsWith(pin('b', 'Fine')), []);
});

check('a NEW rule is one class and one registration', async () => {
  // Stands in for Sprint 2's "a pin needs a responsible company".
  class RequiresOpenStatusRule extends AnnotationRule {
    check(annotation) {
      return annotation.status === PinStatus.OPEN
        ? null
        : new RuleViolation('demo-open-only', 'Demo: pins must start Open.', 'status');
    }
  }

  AnnotationRuleRegistry.register('pin', new RequiresOpenStatusRule());
  try {
    const { editor } = build();

    // Both rules now apply, and EditorService was not touched to make it so.
    const problems = editor.problemsWith(pin('a', '', PinStatus.CLOSED));
    assert.deepEqual(problems.map((p) => p.code).sort(), [
      'demo-open-only',
      RequiredDescriptionRule.CODE,
    ]);

    await assert.rejects(
      () => editor.add(pin('a', 'Described', PinStatus.CLOSED)),
      AnnotationIncompleteError,
    );
  } finally {
    // Undo the demo registration so later checks see the real configuration.
    AnnotationRuleRegistry.reset();
    AnnotationRuleRegistry.register('pin', new RequiredDescriptionRule());
  }
});

// =========================================================================
// PART 2 — attribution, and the seam Sprint 2 plugs into
// =========================================================================

check('every change is recorded, with who and when', async () => {
  const { editor, changeLog } = build();
  const created = pin('a', 'Cracked tile');

  await editor.add(created);
  await editor.update(created, created.withLabel('Cracked tile, 2 places'), 'Describe');

  const history = await changeLog.listForAnnotation(SHEET, 'a');

  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((record) => record.intent).sort(),
    ['create', 'update'],
  );
  assert.ok(history.every((record) => record.actor instanceof Actor));
  assert.ok(history.every((record) => record.at), 'every record needs a timestamp');
});

check('with nobody signed in, changes are attributed honestly', async () => {
  const { editor, changeLog } = build();
  await editor.add(pin('a'));

  const [record] = await changeLog.listForAnnotation(SHEET, 'a');

  assert.equal(record.actor.isAnonymous, true);
  assert.equal(record.describe(), 'this device added it');
});

check('latestBySheet answers "last updated and by whom" in one read', async () => {
  const { editor, changeLog } = build();
  const first = pin('a', 'One');
  const second = pin('b', 'Two');

  await editor.add(first);
  await editor.add(second);
  await editor.move(first, 5, 5);

  const latest = await changeLog.latestBySheet(SHEET);

  assert.equal(latest.size, 2, 'one entry per annotation, not per change');
  assert.equal(latest.get('a').intent, 'move', 'the NEWEST change wins');
  assert.equal(latest.get('b').intent, 'create');
});

check('undo and redo are recorded too', async () => {
  // Undo replays a stored write straight to the repository, walking past the
  // recording step. Without `Command.affects()` the log would keep reporting an
  // edit that had just been reversed, and "last updated by" would describe
  // something no longer true.
  const { editor, changeLog } = build();
  const created = pin('a', 'Cracked tile');

  await editor.add(created);
  await editor.update(created, created.withLabel('Cracked tile, 2 places'), 'Describe');
  await editor.undo();

  const history = await changeLog.listForAnnotation(SHEET, 'a');

  assert.equal(history.length, 3, 'create, update, and the undo of that update');
  assert.match(history[0].detail, /^Undid/, 'the newest entry must be the undo');

  await editor.redo();
  const afterRedo = await changeLog.listForAnnotation(SHEET, 'a');
  assert.match(afterRedo[0].detail, /^Redid/);
});

check('clearing a sheet records each removal against its own item', async () => {
  // Per annotation, not one "cleared the sheet" entry: a user asking what
  // happened to item 14 should find the answer on item 14.
  const { editor, changeLog } = build();
  await editor.add(pin('a', 'One'));
  await editor.add(pin('b', 'Two'));

  await editor.clearSheet(SHEET);

  for (const id of ['a', 'b']) {
    const history = await changeLog.listForAnnotation(SHEET, id);
    assert.equal(history[0].intent, 'delete', `${id} must record its own removal`);
    assert.equal(history[0].detail, 'Cleared');
  }
});

check('history survives a failed write without recording it', async () => {
  const { editor, changeLog } = build();

  await assert.rejects(() => editor.add(pin('a', '')), AnnotationIncompleteError);

  assert.deepEqual(
    await changeLog.listForAnnotation(SHEET, 'a'),
    [],
    'a refused change never happened and must not be in the log',
  );
});

check('SIGNING A USER IN IS ONE LINE — the Sprint 2 promise', async () => {
  // This is the whole claim, executed. Everything else in the application is
  // built and wired exactly as it is today; the ONLY difference is which
  // IdentityProvider the container hands over.
  const rivera = new Actor({
    id: 'usr_7f3a',
    displayName: 'J. Rivera',
    company: 'Apex Electrical',
    role: 'power_collaborator',
  });

  const { editor, changeLog } = build({
    identity: new StaticIdentityProvider(rivera), // <- the entire change
  });

  await editor.add(pin('a', 'Conduit not clipped'));

  const [record] = await changeLog.listForAnnotation(SHEET, 'a');
  assert.equal(record.actor.id, 'usr_7f3a');
  assert.equal(record.describe(), 'J. Rivera (Apex Electrical) added it');

  // The actor also reaches the policy, which is what makes roles work.
  assert.equal(editor.currentActor().role, 'power_collaborator');
});

check('RoleEditPolicy works off that same actor, with no other wiring', async () => {
  const collaborator = new Actor({
    id: 'usr_b21',
    displayName: 'A. Chen',
    company: 'Metro Drywall',
    role: 'collaborator',
  });

  const { editor } = build({
    identity: new StaticIdentityProvider(collaborator),
    policy: new CompositeEditPolicy([new RoleEditPolicy()]),
  });

  // A collaborator may add photos and comments...
  await editor.add(pin('a', 'Scuff on wall'));

  // ...but may not move, delete, or change status.
  for (const attempt of [
    () => editor.move(pin('a'), 5, 5),
    () => editor.remove(pin('a')),
  ]) {
    await assert.rejects(attempt, (error) => {
      assert.ok(error instanceof EditNotPermittedError);
      assert.equal(error.code, 'role');
      return true;
    });
  }
});

check('RoleEditPolicy fails CLOSED for an unidentified user', async () => {
  // Enabling roles before sign-in exists must refuse everything rather than
  // silently allow it. This is why the policy stays commented out today.
  const { editor } = build({
    policy: new CompositeEditPolicy([new RoleEditPolicy()]),
  });

  await assert.rejects(
    () => editor.add(pin('a', 'Anything')),
    (error) => error.code === 'unauthenticated',
  );
});

check('a comment will need no new storage — the intent already fits', async () => {
  // FR-11 is Sprint 2. Recording a comment is an existing intent on the
  // existing log, which is the point of modelling attribution as a change
  // record rather than as columns on the annotation.
  assert.ok(Object.values(EditPolicy.INTENT).includes('comment'));

  const { changeLog } = build();
  const { ChangeRecord } = await import('../src/domain/audit/ChangeRecord.js');

  await changeLog.record(
    new ChangeRecord({
      id: 'c1',
      annotationId: 'a',
      sheetId: SHEET,
      intent: EditPolicy.INTENT.COMMENT,
      actor: Actor.ANONYMOUS,
      at: new Date().toISOString(),
      detail: 'Looks done to me',
    }),
  );

  const [record] = await changeLog.listForAnnotation(SHEET, 'a');
  assert.equal(record.describe(), 'this device commented on it');
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

console.log(`\n${checks.length - failed}/${checks.length} rule and attribution checks passed.`);
process.exit(failed === 0 ? 0 : 1);
