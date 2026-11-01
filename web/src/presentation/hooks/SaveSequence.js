/**
 * Saves made from one sheet, one at a time and in the order they were made —
 * and reads of the sheet that can tell when they have been overtaken.
 *
 * ===========================================================================
 * THE BUG THIS FIXES — an edit that showed on screen and was never kept
 * ===========================================================================
 * Each save sent the whole item, and nothing ordered them. Fill in a pin's
 * trade and tab straight into its company, and two saves were in flight at
 * once: the company's built from the copy on screen, which did not have the
 * trade yet, because the read that would bring it back had not returned. One
 * of the two was overwritten by the other — on the live server, over a real
 * network, every other field of a quickly filled-in item was lost — while the
 * panel went on showing what had been typed. A read that came back late could
 * also put an older copy back on screen after a newer one, which is why an
 * item's "Overdue" notice only appeared once it was selected again.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT GUARANTEES
 * ---------------------------------------------------------------------------
 *   write   runs after every write queued before it has settled, so they reach
 *           storage in the order they were made; a failure is reported to its
 *           own caller and does not stop the queue
 *   read    says whether its answer is still the newest thing to show: not
 *           once a newer read has started, and not while any write is queued
 *           or in flight — that write's own read will bring the truth
 *
 * Plain JavaScript and no React, so the ordering can be tested on its own.
 */
export class SaveSequence {
  #tail = Promise.resolve();
  #pending = 0;
  #reads = 0;

  /**
   * @template T
   * @param {() => Promise<T>} work
   * @returns {Promise<T>} Settles as `work` does.
   */
  write(work) {
    this.#pending += 1;
    const turn = this.#tail.then(() => work());
    // The queue moves on whatever this write does; its caller sees the outcome.
    this.#tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn.finally(() => {
      this.#pending -= 1;
    });
  }

  /**
   * Starts a read.
   * @returns {() => boolean} Whether the read's answer may still be shown.
   */
  read() {
    const mine = ++this.#reads;
    return () => mine === this.#reads && this.#pending === 0;
  }

  /** Writes queued or in flight. */
  get pending() {
    return this.#pending;
  }
}
