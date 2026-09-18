import { Command } from './Command';

/**
 * The three primitive reversible edits, plus a composite.
 *
 * Grouped in one file because each is a handful of lines and they are only
 * meaningful as a set — every mutation in the application is one of these.
 * A fourth primitive would justify splitting them out.
 *
 * All of them go through `AnnotationRepository`, whose `save` is an UPSERT and
 * whose `delete` tolerates an already-missing row. Those two properties are
 * what make the inverses below correct without extra bookkeeping: undoing an
 * add is a delete, undoing a delete is a save, and both are safe to repeat.
 */

/** Creates an annotation. Undone by deleting it. */
export class AddAnnotationCommand extends Command {
  constructor(repository, annotation) {
    super();
    this.repository = repository;
    this.annotation = annotation;
  }

  describe() {
    return `Add ${this.annotation.getKind()}`;
  }

  affects() {
    return [this.annotation];
  }

  async execute() {
    await this.repository.save(this.annotation);
  }

  async undo() {
    await this.repository.delete(this.annotation.id);
  }
}

/** Removes an annotation. Undone by putting the same object back. */
export class DeleteAnnotationCommand extends Command {
  constructor(repository, annotation) {
    super();
    this.repository = repository;
    // The whole annotation is retained, not just its id. Domain objects are
    // immutable and frozen, so holding the reference is safe and is what makes
    // the undo an exact restoration rather than a reconstruction.
    this.annotation = annotation;
  }

  describe() {
    return `Delete ${this.annotation.getKind()}`;
  }

  affects() {
    return [this.annotation];
  }

  async execute() {
    await this.repository.delete(this.annotation.id);
  }

  async undo() {
    await this.repository.save(this.annotation);
  }
}

/**
 * Replaces an annotation with a modified copy — a move, a status change, an
 * edited label. Undone by saving the previous value back.
 *
 * Both versions share an id, so the repository's upsert overwrites in place and
 * the annotation keeps its identity and its position in the list. That is why
 * moving a pin does not renumber every pin after it.
 */
export class UpdateAnnotationCommand extends Command {
  constructor(repository, previous, next, label = 'Edit') {
    super();
    this.repository = repository;
    this.previous = previous;
    this.next = next;
    this.label = label;
  }

  describe() {
    return `${this.label} ${this.next.getKind()}`;
  }

  /**
   * `next` rather than `previous`: both carry the same id and sheet, which is
   * all the log needs, and `next` is what exists after a redo.
   */
  affects() {
    return [this.next];
  }

  async execute() {
    await this.repository.save(this.next);
  }

  async undo() {
    await this.repository.save(this.previous);
  }
}

/**
 * Runs several commands as one undoable step.
 *
 * Needed for "clear all", which is otherwise the one destructive action with no
 * way back — the exact situation that makes a user afraid to touch anything.
 *
 * Undo runs the children in REVERSE order. That matters for any future
 * composite whose steps depend on each other; for a batch of independent
 * deletes it is merely correct rather than essential, but getting the ordering
 * right once here means composites can be trusted later.
 */
export class CompositeCommand extends Command {
  constructor(commands, label) {
    super();
    this.commands = commands;
    this.label = label;
  }

  describe() {
    return this.label;
  }

  /** Flattened, so a nested composite still reports everything it moved. */
  affects() {
    return this.commands.flatMap((command) => command.affects());
  }

  async execute() {
    for (const command of this.commands) await command.execute();
  }

  async undo() {
    for (let i = this.commands.length - 1; i >= 0; i--) await this.commands[i].undo();
  }
}
