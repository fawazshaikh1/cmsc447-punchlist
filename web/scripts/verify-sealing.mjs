/**
 * Checks the sealing rules against the real domain classes.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * "Issued markups cannot be changed" is a promise the product makes to a user
 * who has already sent a PDF to an architect. A promise like that should not
 * rest on someone remembering to click through the app before a release, and
 * it certainly should not rest on the interface, which is only the polite half
 * of the rule — `EditorService` is the half that enforces it.
 *
 * So this exercises the enforcement directly, with the UI entirely absent. If
 * these pass, a sealed markup cannot be changed even by code that never asked
 * whether it could.
 *
 * Plain Node and `node:assert` — no test framework, no new dependency, nothing
 * to configure. Run it with:
 *
 *     npm run verify:sealing
 */
import assert from 'node:assert/strict';

import { Pin, PinStatus } from '../src/domain/annotations/Pin.js';
import '../src/domain/annotations/index.js';
// Registers the completeness rules, so these checks run against the same
// configuration the application does — a pin needs a description here too.
import '../src/domain/rules/index.js';
import { PdfPoint } from '../src/domain/geometry/PdfPoint.js';
import {
  ActiveSeals,
  CompositeEditPolicy,
  EditNotPermittedError,
  SealedByExportPolicy,
} from '../src/domain/policy/index.js';
import { AnnotationService } from '../src/domain/services/AnnotationService.js';
import { EditorService } from '../src/domain/services/EditorService.js';
import { ExportService } from '../src/domain/services/ExportService.js';
import { IdGenerator } from '../src/domain/ports/IdGenerator.js';
import { SheetExporter } from '../src/domain/ports/SheetExporter.js';
import { InMemoryAnnotationRepository } from '../src/infrastructure/persistence/InMemoryAnnotationRepository.js';
import { InMemoryExportHistoryRepository } from '../src/infrastructure/persistence/InMemoryExportHistoryRepository.js';

// --- test doubles -----------------------------------------------------------

/** Predictable ids, so a failure names the same annotation every run. */
class SequentialIds extends IdGenerator {
  #n = 0;
  next() {
    this.#n += 1;
    return `ann-${this.#n}`;
  }
}

/** Produces no real PDF. Only `seals()` matters to these checks. */
class FakeExporter extends SheetExporter {
  constructor(seals) {
    super();
    this.sealsFlag = seals;
  }
  async exportAnnotated() {
    return new Uint8Array([1, 2, 3]);
  }
  seals() {
    return this.sealsFlag;
  }
}

// --- harness ----------------------------------------------------------------

const SHEET = 'drawing.pdf#0';
const DOCUMENT = 'drawing.pdf';

function build() {
  const repository = new InMemoryAnnotationRepository();
  const history = new InMemoryExportHistoryRepository();
  const ids = new SequentialIds();
  const activeSeals = new ActiveSeals();

  const annotations = new AnnotationService(repository, ids);
  const policy = new CompositeEditPolicy([
    new SealedByExportPolicy(() => activeSeals.ids),
  ]);
  const editor = new EditorService(repository, { policy });

  const exportFlat = new ExportService(annotations, new FakeExporter(true), history, ids);
  const exportNative = new ExportService(annotations, new FakeExporter(false), history, ids);

  return { repository, history, ids, activeSeals, annotations, editor, exportFlat, exportNative };
}

function pin(id, label = 'Cracked tile') {
  return new Pin(
    id,
    SHEET,
    new PdfPoint(100, 200),
    label,
    PinStatus.OPEN,
    new Date('2026-09-18T12:00:00Z'),
  );
}

/** Runs an export and pushes whatever it sealed into the live seal set. */
async function issue(service, { activeSeals }) {
  const result = await service.exportDocument({
    sourceBytes: new ArrayBuffer(8),
    pageCount: 1,
    sheetIdFor: () => SHEET,
    author: 'Verifier',
    documentName: DOCUMENT,
  });
  if (result.sealed) {
    activeSeals.add(Object.values(result.sealed.annotationIdsBySheet).flat());
  }
  return result;
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// --- the rules --------------------------------------------------------------

check('an unissued markup can be edited, moved and deleted', async () => {
  const app = build();
  await app.editor.add(pin('a'));

  assert.equal(app.editor.canEdit(pin('a')).allowed, true);
  assert.equal(app.editor.isLocked(pin('a')), false);

  await app.editor.update(pin('a'), pin('a', 'cracked tile'), 'Describe');
  await app.editor.move(pin('a'), 5, 5);
  await app.editor.remove(pin('a'));

  assert.deepEqual(await app.repository.listBySheet(SHEET), []);
});

check('a FLATTENED export seals everything it contained', async () => {
  const app = build();
  await app.editor.add(pin('a'));
  await app.editor.add(pin('b'));

  const result = await issue(app.exportFlat, app);

  assert.ok(result.sealed, 'a flattened export must return the record it wrote');
  assert.equal(result.sealed.mode, 'flattened');
  assert.equal(result.sealed.annotationCount, 2);
  assert.deepEqual([...app.activeSeals.ids].sort(), ['a', 'b']);
});

check('a NATIVE export seals nothing', async () => {
  const app = build();
  await app.editor.add(pin('a'));

  const result = await issue(app.exportNative, app);

  assert.equal(result.sealed, null, 'a native export is a working copy, not an issue');
  assert.equal(app.activeSeals.size, 0);

  // Still recorded, though — the history answers "what has left this project?".
  const recorded = await app.history.listForDocument(DOCUMENT);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].mode, 'native');
  assert.equal(recorded[0].seals, false);
});

check('every mutation on a sealed markup is REFUSED, not silently ignored', async () => {
  const app = build();
  await app.editor.add(pin('a'));
  await issue(app.exportFlat, app);

  const sealed = pin('a');

  assert.equal(app.editor.isLocked(sealed), true);

  for (const [name, attempt] of [
    ['update', () => app.editor.update(sealed, pin('a', 'changed'), 'Describe')],
    ['move', () => app.editor.move(sealed, 10, 10)],
    ['remove', () => app.editor.remove(sealed)],
  ]) {
    await assert.rejects(
      attempt,
      (error) => {
        assert.ok(
          error instanceof EditNotPermittedError,
          `${name} threw ${error?.name}, not EditNotPermittedError`,
        );
        assert.equal(error.code, 'sealed');
        assert.match(error.message, /permanent record/);
        return true;
      },
      `${name} on a sealed markup must be refused`,
    );
  }

  // And the stored annotation is untouched — a refusal that half-wrote would be
  // worse than no refusal at all.
  const [stored] = await app.repository.listBySheet(SHEET);
  assert.equal(stored.label, 'Cracked tile');
  assert.equal(stored.getAnchor().x, 100);
});

check('a markup created AFTER the export stays editable', async () => {
  const app = build();
  await app.editor.add(pin('old'));
  await issue(app.exportFlat, app);

  await app.editor.add(pin('new'));

  assert.equal(app.editor.isLocked(pin('old')), true);
  assert.equal(app.editor.isLocked(pin('new')), false);

  await app.editor.update(pin('new'), pin('new', 'snagged'), 'Describe');
});

check('clearing a sheet skips sealed markups and reports what it kept', async () => {
  const app = build();
  await app.editor.add(pin('old'));
  await issue(app.exportFlat, app);
  await app.editor.add(pin('new'));

  const { removed, keptSealed } = await app.editor.clearSheet(SHEET);

  assert.equal(removed, 1);
  assert.equal(keptSealed, 1);

  const remaining = await app.repository.listBySheet(SHEET);
  assert.deepEqual(remaining.map((a) => a.id), ['old']);
});

check('a second export seals the newer markups without unsealing the older', async () => {
  const app = build();
  await app.editor.add(pin('first'));
  await issue(app.exportFlat, app);
  await app.editor.add(pin('second'));
  await issue(app.exportFlat, app);

  assert.deepEqual([...app.activeSeals.ids].sort(), ['first', 'second']);
  assert.equal((await app.history.listForDocument(DOCUMENT)).length, 2);
});

check('seals are recovered from history for a sheet, across a restart', async () => {
  const app = build();
  await app.editor.add(pin('a'));
  await issue(app.exportFlat, app);

  // A fresh session: same storage, nothing in memory.
  const reopened = await app.history.sealedIdsForSheet(DOCUMENT, SHEET);
  assert.deepEqual([...reopened], ['a']);

  // A sheet that was never exported carries no seals.
  const other = await app.history.sealedIdsForSheet(DOCUMENT, 'drawing.pdf#9');
  assert.equal(other.size, 0);
});

check('an export that sealed nothing does not write a record', async () => {
  const app = build();
  const result = await issue(app.exportFlat, app);

  assert.equal(result.annotationCount, 0);
  assert.equal(result.sealed, null);
  assert.equal((await app.history.listForDocument(DOCUMENT)).length, 0);
});

check('the policy seam accepts a new rule without touching EditorService', async () => {
  // Stands in for RoleEditPolicy: proof that adding a second reason to refuse is
  // a new class plus one array entry, exactly as claimed.
  const { EditDecision, EditPolicy } = await import('../src/domain/policy/index.js');

  class NoDeletingPolicy extends EditPolicy {
    check({ intent }) {
      return intent === EditPolicy.INTENT.DELETE
        ? EditDecision.deny('Deleting is disabled in this demo.', 'demo')
        : EditDecision.allow();
    }
  }

  const repository = new InMemoryAnnotationRepository();
  const editor = new EditorService(repository, {
    policy: new CompositeEditPolicy([new NoDeletingPolicy()]),
  });

  await editor.add(pin('a'));
  await editor.update(pin('a'), pin('a', 'still fine'), 'Describe');

  await assert.rejects(
    () => editor.remove(pin('a')),
    (error) => error.code === 'demo',
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

console.log(
  `\n${checks.length - failed}/${checks.length} sealing checks passed.`,
);
process.exit(failed === 0 ? 0 : 1);
