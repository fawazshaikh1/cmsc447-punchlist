import {
  CommandHistory,
  AddAnnotationCommand,
  DeleteAnnotationCommand,
  UpdateAnnotationCommand,
  CompositeCommand,
} from '../commands';
import { AnnotationRepository } from '../ports/AnnotationRepository';
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
 * One write path means undo is correct by construction rather than by
 * discipline. Adding a new kind of edit means adding a method here, and it is
 * undoable the moment it exists.
 *
 *   AnnotationService   READS and shapes drafts (no persistence)
 *   EditorService       WRITES, always through a Command
 *
 * ---------------------------------------------------------------------------
 * WHY THE CALLER RELOADS RATHER THAN BEING PUSHED A NEW LIST
 * ---------------------------------------------------------------------------
 * Each method resolves once the repository is consistent, and the presentation
 * layer then re-reads the sheet. That costs one storage read per edit and buys
 * something worth more: what is on screen is always what is in storage. An
 * optimistic local mutation would let the two drift after an undo, and the
 * divergence would only show up on the next reload — long after the cause.
 */
export class EditorService {
  /**
   * @param {AnnotationRepository} repository
   * @param {CommandHistory} [history]
   */
  constructor(repository, history = new CommandHistory()) {
    assertInstanceOf(repository, AnnotationRepository, 'repository');
    assertInstanceOf(history, CommandHistory, 'history');

    this.repository = repository;
    this.history = history;
  }

  /** @param {import('../annotations/Annotation').Annotation} annotation */
  async add(annotation) {
    await this.history.execute(new AddAnnotationCommand(this.repository, annotation));
    return annotation;
  }

  /** @param {import('../annotations/Annotation').Annotation} annotation */
  async remove(annotation) {
    await this.history.execute(new DeleteAnnotationCommand(this.repository, annotation));
  }

  /**
   * Replaces an annotation with a modified copy.
   * @param {import('../annotations/Annotation').Annotation} previous
   * @param {import('../annotations/Annotation').Annotation} next
   * @param {string} [label] Verb for the undo button, e.g. 'Move', 'Edit'.
   */
  async update(previous, next, label = 'Edit') {
    await this.history.execute(
      new UpdateAnnotationCommand(this.repository, previous, next, label),
    );
    return next;
  }

  /**
   * Translates an annotation by a delta in PDF points.
   *
   * Works for every markup type without knowing which one it has, because
   * `movedBy` is on the Annotation contract. Adding a seventh type gives it
   * drag-to-move for free.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @param {number} dxPts @param {number} dyPts
   */
  async move(annotation, dxPts, dyPts) {
    return this.update(annotation, annotation.movedBy(dxPts, dyPts), 'Move');
  }

  /**
   * Removes every annotation on a sheet, as ONE undoable step.
   *
   * Composed of individual deletes rather than calling the repository's
   * `clearSheet`, specifically so it can be reversed. Clearing a sheet is the
   * single most destructive action available, and an unreversible one is what
   * makes people stop trusting a tool.
   *
   * @param {string} sheetId
   */
  async clearSheet(sheetId) {
    const existing = await this.repository.listBySheet(sheetId);
    if (existing.length === 0) return;

    const deletes = existing.map(
      (annotation) => new DeleteAnnotationCommand(this.repository, annotation),
    );

    await this.history.execute(
      new CompositeCommand(deletes, `Clear ${existing.length} markup(s)`),
    );
  }

  /** @returns {Promise<string|null>} Description of what was undone. */
  async undo() {
    const command = await this.history.undo();
    return command?.describe() ?? null;
  }

  /** @returns {Promise<string|null>} Description of what was redone. */
  async redo() {
    const command = await this.history.redo();
    return command?.describe() ?? null;
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
   */
  reset() {
    this.history.clear();
  }
}
