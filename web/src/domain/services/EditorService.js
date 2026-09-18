import {
  CommandHistory,
  AddAnnotationCommand,
  DeleteAnnotationCommand,
  UpdateAnnotationCommand,
  CompositeCommand,
} from '../commands';
import { ChangeRecord } from '../audit/ChangeRecord';
import { NullChangeLog } from '../audit/NullChangeLog';
import { CounterIdGenerator } from '../identity/CounterIdGenerator';
import { StaticIdentityProvider } from '../identity/StaticIdentityProvider';
import { AnnotationRepository } from '../ports/AnnotationRepository';
import { ChangeLogRepository } from '../ports/ChangeLogRepository';
import { IdGenerator } from '../ports/IdGenerator';
import { IdentityProvider } from '../ports/IdentityProvider';
import { AllowAllPolicy, EditNotPermittedError, EditPolicy } from '../policy';
import { AnnotationIncompleteError, AnnotationRuleRegistry } from '../rules';
import { assertInstanceOf } from '../support/contracts';

/**
 * ===========================================================================
 * EVERY MUTATION IN THE APPLICATION GOES THROUGH THIS CLASS
 * ===========================================================================
 * That is the point of it, and the reason `AnnotationService` no longer writes
 * anything: if two classes could both persist annotations, one of them would
 * eventually skip the history and produce a change that undo silently cannot
 * reverse — the worst kind of undo bug, because the button stays enabled and
 * just does the wrong thing.
 *
 *   AnnotationService   READS and shapes drafts (no persistence)
 *   EditorService       WRITES — and nothing else does
 *
 * ---------------------------------------------------------------------------
 * FOUR THINGS HAPPEN ON EVERY WRITE, IN THIS ORDER
 * ---------------------------------------------------------------------------
 *   1. MAY you?        EditPolicy — refuses issued work, and later, roles
 *   2. IS it finished? AnnotationRuleRegistry — refuses a pin with no
 *                      description
 *   3. DO it           through a Command, so it is reversible
 *   4. WRITE IT DOWN   who did it, when, and what — the audit trail
 *
 * All four live here for one reason: because nothing else writes, doing them
 * here means doing them everywhere. There is no second door to remember to
 * lock, no save path that forgot to validate, and no edit that escaped the log.
 *
 * Steps 1 and 2 are deliberately separate concerns with separate errors. "You
 * may not change this" is final; "this is not finished yet" is a four-second
 * fix. One error type for both would force the interface to guess which tone to
 * use, and the wrong guess is expensive in both directions.
 *
 * ---------------------------------------------------------------------------
 * WHY RECORDING LIVES HERE RATHER THAN IN A DECORATOR
 * ---------------------------------------------------------------------------
 * A `RecordingEditorService` wrapping this one would be the purer expression of
 * "add, don't modify". It was rejected because it would have to re-declare
 * every method purely to delegate, and the day someone adds a seventh mutation
 * here and forgets to add it there, that mutation silently stops being audited
 * — a gap nothing would detect. Cohesion wins over purity when the alternative
 * fails quietly.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CALLER RELOADS RATHER THAN BEING PUSHED A NEW LIST
 * ---------------------------------------------------------------------------
 * Each method resolves once the repository is consistent, and the presentation
 * layer then re-reads the sheet. That costs one storage read per edit and buys
 * something worth more: what is on screen is always what is in storage.
 */
export class EditorService {
  /**
   * @param {AnnotationRepository} repository
   * @param {object} [dependencies] Optional collaborators, each defaulting to
   *        something inert. Named rather than positional because there are now
   *        six of them and `new EditorService(repo, undefined, undefined, x)`
   *        is how wiring mistakes get made.
   * @param {CommandHistory} [dependencies.history]
   * @param {EditPolicy} [dependencies.policy] Defaults to permitting
   *        everything, the honest description of a project with no accounts.
   * @param {IdentityProvider} [dependencies.identity] Who is working. Defaults
   *        to the anonymous placeholder — see Actor for why not null.
   * @param {ChangeLogRepository} [dependencies.changeLog] Where attribution is
   *        written. Defaults to remembering nothing.
   * @param {IdGenerator} [dependencies.ids] Ids for log entries only.
   * @param {() => string} [dependencies.clock] ISO-8601 now, injectable so a
   *        test can assert an exact timestamp.
   */
  constructor(
    repository,
    {
      history = new CommandHistory(),
      policy = new AllowAllPolicy(),
      identity = new StaticIdentityProvider(),
      changeLog = new NullChangeLog(),
      ids = new CounterIdGenerator(),
      clock = () => new Date().toISOString(),
    } = {},
  ) {
    assertInstanceOf(repository, AnnotationRepository, 'repository');
    assertInstanceOf(history, CommandHistory, 'history');
    assertInstanceOf(policy, EditPolicy, 'policy');
    assertInstanceOf(identity, IdentityProvider, 'identity');
    assertInstanceOf(changeLog, ChangeLogRepository, 'changeLog');
    assertInstanceOf(ids, IdGenerator, 'ids');

    this.repository = repository;
    this.history = history;
    this.policy = policy;
    this.identity = identity;
    this.changeLog = changeLog;
    this.ids = ids;
    this.clock = clock;
  }

  // =========================================================================
  // ASKING — no side effects. The interface uses these to decide what to offer.
  // =========================================================================

  /**
   * Whether a change would be permitted, WITHOUT attempting it.
   *
   * Synchronous on purpose: it runs on every render of the properties panel,
   * and a promise there would mean a frame showing the wrong state.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @param {string} [intent] One of EditPolicy.INTENT.
   * @returns {import('../policy').EditDecision}
   */
  canEdit(annotation, intent = EditPolicy.INTENT.UPDATE) {
    return this.policy.check({ annotation, intent, actor: this.identity.current() });
  }

  /**
   * True when nothing at all may be changed about this annotation.
   * @param {import('../annotations/Annotation').Annotation} annotation
   */
  isLocked(annotation) {
    return [
      EditPolicy.INTENT.UPDATE,
      EditPolicy.INTENT.MOVE,
      EditPolicy.INTENT.DELETE,
    ].every((intent) => this.canEdit(annotation, intent).denied);
  }

  /**
   * What is still missing from this annotation, if anything.
   *
   * Asked during render so the panel can point at the empty description box and
   * the overlay can mark the markup. Delegates to the registry rather than
   * knowing any rule itself — a second rule added in Sprint 2 shows up here
   * with no change to this method or its callers.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @returns {import('../rules').RuleViolation[]} Empty when complete.
   */
  problemsWith(annotation) {
    return AnnotationRuleRegistry.validate(annotation);
  }

  /** Who the application currently believes is working. */
  currentActor() {
    return this.identity.current();
  }

  // =========================================================================
  // WRITING — checked, validated, reversible, recorded.
  // =========================================================================

  /** @param {import('../annotations/Annotation').Annotation} annotation */
  async add(annotation) {
    this.#requirePermitted(annotation, EditPolicy.INTENT.CREATE);

    // New work is held to the full standard with no exceptions. The tool
    // collects a description before the pin exists, so reaching this throw
    // means something bypassed the tool — which is exactly when it should fail
    // loudly rather than storing a blank pin that reaches an architect.
    this.#requireComplete(annotation);

    await this.history.execute(new AddAnnotationCommand(this.repository, annotation));
    await this.#recordChange(annotation, EditPolicy.INTENT.CREATE, 'Added');

    return annotation;
  }

  /** @param {import('../annotations/Annotation').Annotation} annotation */
  async remove(annotation) {
    this.#requirePermitted(annotation, EditPolicy.INTENT.DELETE);
    await this.history.execute(new DeleteAnnotationCommand(this.repository, annotation));
    await this.#recordChange(annotation, EditPolicy.INTENT.DELETE, 'Deleted');
  }

  /**
   * Replaces an annotation with a modified copy.
   *
   * @param {import('../annotations/Annotation').Annotation} previous
   * @param {import('../annotations/Annotation').Annotation} next
   * @param {string} [label] Verb for the undo button, e.g. 'Move', 'Edit'.
   * @param {string} [intent] One of EditPolicy.INTENT. Lets a caller say what
   *        KIND of change this is, so a future role rule can permit editing a
   *        description while refusing a status change.
   */
  async update(previous, next, label = 'Edit', intent = EditPolicy.INTENT.UPDATE) {
    // Checked against `previous`, never `next`: the question is whether the
    // thing already on the sheet may be touched. Checking the replacement would
    // let a caller escape a seal by handing over an object with a fresh id.
    this.#requirePermitted(previous, intent);
    this.#requireNoNewProblems(previous, next);

    await this.history.execute(
      new UpdateAnnotationCommand(this.repository, previous, next, label),
    );
    await this.#recordChange(next, intent, label);

    return next;
  }

  /**
   * Translates an annotation by a delta in PDF points.
   *
   * Works for every markup type without knowing which one it has, because
   * `movedBy` is on the Annotation contract.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @param {number} dxPts @param {number} dyPts
   */
  async move(annotation, dxPts, dyPts) {
    return this.update(
      annotation,
      annotation.movedBy(dxPts, dyPts),
      'Move',
      EditPolicy.INTENT.MOVE,
    );
  }

  /**
   * Removes every annotation on a sheet that may be removed, as ONE undoable
   * step.
   *
   * Composed of individual deletes rather than calling the repository's
   * `clearSheet`, specifically so it can be reversed.
   *
   * Sealed markups are SKIPPED rather than blocking the whole operation: a
   * sheet issued last week and worked on since holds both kinds, and refusing
   * outright would leave no way to clear the new markups. The count of what
   * stayed is returned, because silently removing fewer items than the button
   * implies would be its own kind of lie.
   *
   * @param {string} sheetId
   * @returns {Promise<{ removed: number, keptSealed: number }>}
   */
  async clearSheet(sheetId) {
    const existing = await this.repository.listBySheet(sheetId);

    const removable = existing.filter(
      (annotation) => this.canEdit(annotation, EditPolicy.INTENT.DELETE).allowed,
    );
    const keptSealed = existing.length - removable.length;

    if (removable.length === 0) return { removed: 0, keptSealed };

    const deletes = removable.map(
      (annotation) => new DeleteAnnotationCommand(this.repository, annotation),
    );

    await this.history.execute(
      new CompositeCommand(deletes, `Clear ${removable.length} markup(s)`),
    );

    // Recorded individually, not as one "cleared the sheet" entry. The history
    // is per annotation, and a user asking what happened to item 14 should find
    // the answer on item 14.
    for (const annotation of removable) {
      await this.#recordChange(annotation, EditPolicy.INTENT.DELETE, 'Cleared');
    }

    return { removed: removable.length, keptSealed };
  }

  /**
   * @returns {Promise<string|null>} Description of what was undone.
   *
   * Recorded like any other change. Undo replays a stored write straight to the
   * repository, so without this the log would still report an edit that had
   * just been reversed — and "last updated by" would be describing something
   * that is no longer true.
   */
  async undo() {
    const command = await this.history.undo();
    if (!command) return null;

    await this.#recordCommand(command, 'Undid');
    return command.describe();
  }

  /** @returns {Promise<string|null>} Description of what was redone. */
  async redo() {
    const command = await this.history.redo();
    if (!command) return null;

    await this.#recordCommand(command, 'Redid');
    return command.describe();
  }

  canUndo() {
    return this.history.canUndo();
  }

  canRedo() {
    return this.history.canRedo();
  }

  peekUndo() {
    return this.history.peekUndo();
  }

  peekRedo() {
    return this.history.peekRedo();
  }

  /**
   * Discards the history. Call when a different document is opened — commands
   * hold references to the old sheet's annotations, and undoing one afterwards
   * would write a stale annotation into the new document's storage.
   *
   * It is ALSO what stops undo from unpicking a seal. After a flattened export
   * the history is cleared, so no stack entry remains that could put a sealed
   * markup back the way it was.
   *
   * The change log is NOT cleared. It is history, and history does not reset
   * because someone opened a different drawing.
   */
  reset() {
    this.history.clear();
  }

  // --- internals ----------------------------------------------------------

  /**
   * The permission gate. Throws rather than returning, because by the time a
   * caller reaches a write the interface should already have used `canEdit`.
   * Anything arriving here has bypassed that, and the one outcome that must not
   * happen is a quiet success.
   *
   * @throws {EditNotPermittedError}
   */
  #requirePermitted(annotation, intent) {
    const decision = this.policy.check({
      annotation,
      intent,
      actor: this.identity.current(),
    });
    if (decision.denied) throw new EditNotPermittedError(decision);
  }

  /** @throws {AnnotationIncompleteError} */
  #requireComplete(annotation) {
    const violations = AnnotationRuleRegistry.validate(annotation);
    if (violations.length > 0) throw new AnnotationIncompleteError(violations);
  }

  /**
   * An edit may not INTRODUCE a problem, but it may leave one alone.
   *
   * =========================================================================
   * WHY THIS IS NOT SIMPLY `#requireComplete(next)`
   * =========================================================================
   * Pins created before this rule existed have no description. If every update
   * demanded completeness, those pins would be frozen — you could not move
   * them, could not change their status, and could not even open the panel and
   * type the missing description, because saving it would be an update to an
   * annotation that was incomplete when it started.
   *
   * The rule that actually works is "do not make things worse":
   *
   *   complete   -> incomplete   refused. You cannot delete a description.
   *   incomplete -> incomplete   allowed. Move it, or start fixing it.
   *   incomplete -> complete     allowed, obviously. This is the repair path.
   *
   * Compared by code rather than by count, so swapping one problem for a
   * different one is still caught.
   *
   * @throws {AnnotationIncompleteError}
   */
  #requireNoNewProblems(previous, next) {
    const before = new Set(
      AnnotationRuleRegistry.validate(previous).map((violation) => violation.code),
    );
    const introduced = AnnotationRuleRegistry.validate(next).filter(
      (violation) => !before.has(violation.code),
    );

    if (introduced.length > 0) throw new AnnotationIncompleteError(introduced);
  }

  /**
   * Records an undo or redo against every annotation the command moved.
   *
   * The intent stays `update` rather than gaining an `undo` of its own: from
   * the sheet's point of view the markup changed, and that is what the log is
   * for. `detail` carries the distinction for anyone reading the history.
   */
  async #recordCommand(command, verb) {
    for (const annotation of command.affects()) {
      await this.#recordChange(
        annotation,
        EditPolicy.INTENT.UPDATE,
        `${verb} ${command.describe().toLowerCase()}`,
      );
    }
  }

  /**
   * Writes down who did what.
   *
   * Runs AFTER the command has succeeded, so the log never claims a change that
   * did not happen. It is also never allowed to undo one: a failure to write
   * history must not fail the edit the user already made, so this swallows.
   * The local adapter swallows too — belt and braces, because this is the one
   * place in the codebase where losing data is the lesser harm.
   */
  async #recordChange(annotation, intent, detail) {
    try {
      await this.changeLog.record(
        new ChangeRecord({
          id: this.ids.next(),
          annotationId: annotation.id,
          sheetId: annotation.sheetId,
          intent,
          actor: this.identity.current(),
          at: this.clock(),
          detail,
        }),
      );
    } catch (error) {
      console.warn('[punchlist] Could not record who made this change.', error);
    }
  }
}
