import { Command } from './Command';
import { assertInstanceOf } from '../support/contracts';

/** How many steps back a user can go. */
const DEFAULT_LIMIT = 100;

/**
 * The undo/redo stack.
 *
 * Two stacks: everything done (`past`) and everything undone but not yet
 * redone (`future`). Executing a NEW command clears the future, which is the
 * standard behaviour every editor has — once you branch off an undone timeline,
 * the old branch is gone.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A LIMIT
 * ---------------------------------------------------------------------------
 * A `DeleteAnnotationCommand` holds a reference to the annotation it removed so
 * it can restore it. That is exactly right for undo and exactly wrong for
 * memory if the history grows without bound — a long session of drawing and
 * erasing freehand strokes would retain every stroke ever deleted.
 *
 * Capping the past at 100 steps means the oldest entry is dropped, and its
 * retained annotation becomes garbage. A hundred steps is far more than anyone
 * undoes in practice and bounds the worst case.
 */
export class CommandHistory {
  #past = [];
  #future = [];
  #limit;

  constructor(limit = DEFAULT_LIMIT) {
    this.#limit = limit;
  }

  /**
   * Runs a command and records it.
   *
   * If `execute()` throws, the command is NOT recorded — a failed write must
   * not leave an entry in the history whose undo would then "reverse" something
   * that never happened.
   *
   * @param {Command} command
   * @returns {Promise<void>}
   */
  async execute(command) {
    assertInstanceOf(command, Command, 'command');

    await command.execute();

    this.#past.push(command);
    // Doing something new abandons the redo branch.
    this.#future = [];

    if (this.#past.length > this.#limit) this.#past.shift();
  }

  /** @returns {Promise<Command | null>} The command undone, or null. */
  async undo() {
    const command = this.#past.pop();
    if (!command) return null;

    try {
      await command.undo();
    } catch (error) {
      // Put it back: if the reversal failed, the change is still applied and
      // the history must keep saying so. Losing the entry here would make the
      // stack disagree with reality, and every later undo would be wrong.
      this.#past.push(command);
      throw error;
    }

    this.#future.push(command);
    return command;
  }

  /** @returns {Promise<Command | null>} The command redone, or null. */
  async redo() {
    const command = this.#future.pop();
    if (!command) return null;

    try {
      await command.execute();
    } catch (error) {
      this.#future.push(command);
      throw error;
    }

    this.#past.push(command);
    return command;
  }

  canUndo() {
    return this.#past.length > 0;
  }

  canRedo() {
    return this.#future.length > 0;
  }

  /** Label of the next undo, for the button's tooltip. @returns {string|null} */
  peekUndo() {
    return this.#past.at(-1)?.describe() ?? null;
  }

  /** @returns {string|null} */
  peekRedo() {
    return this.#future.at(-1)?.describe() ?? null;
  }

  /**
   * Discards all history.
   *
   * Called when the user opens a different drawing: commands hold references to
   * annotations on the old sheet, and undoing one after switching would write
   * a stale annotation into the new document's storage.
   */
  clear() {
    this.#past = [];
    this.#future = [];
  }
}
