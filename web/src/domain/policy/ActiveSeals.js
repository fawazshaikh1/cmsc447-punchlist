/**
 * The set of annotation ids sealed on the sheet currently open, plus a way to
 * be told when it changes.
 *
 * ===========================================================================
 * WHY THIS EXISTS — A TIMING PROBLEM, NOT A STORAGE ONE
 * ===========================================================================
 * The seals themselves live in ExportHistoryRepository, which is asynchronous.
 * But SealedByExportPolicy is asked on every render of the properties panel and
 * must answer immediately — a promise there would mean a frame showing the
 * wrong state, which for a lock means a frame where a sealed markup looks
 * editable and someone starts typing into it.
 *
 * So the sheet's seals are read once when it opens and held here, and the
 * policy reads this. This object is the synchronous face of asynchronous
 * storage, and its single job is keeping those two in step.
 *
 * ---------------------------------------------------------------------------
 * WHY IT NOTIFIES
 * ---------------------------------------------------------------------------
 * The moment an export completes, controls that were live must become locked.
 * Without notification React would have no idea anything had changed and the
 * panel would keep offering edits that the service has already started
 * refusing — the interface and the rules would disagree until the next
 * unrelated re-render.
 *
 * A plain observable rather than React state because the policy lives in the
 * domain and must not import React. The hook subscribes; the domain does not
 * know it did.
 */
export class ActiveSeals {
  #ids = new Set();
  #listeners = new Set();

  /**
   * The sealed ids, as a live Set.
   *
   * Handed out directly rather than copied because it is read on every policy
   * check — and every one of those happens during a render. Callers must treat
   * it as read-only; `replace` is the way to change it, so that listeners run.
   */
  get ids() {
    return this.#ids;
  }

  get size() {
    return this.#ids.size;
  }

  /** @param {string} id */
  has(id) {
    return this.#ids.has(id);
  }

  /**
   * Swaps in the seals for a newly opened sheet.
   * @param {Iterable<string>} ids
   */
  replace(ids) {
    this.#ids = new Set(ids);
    this.#notify();
  }

  /**
   * Adds ids sealed by an export that just completed.
   *
   * Separate from `replace` because the two are different events with different
   * risks. Replacing is "here is the truth for this sheet". Adding is "these
   * just became permanent" — and merging rather than overwriting means an
   * export cannot accidentally drop a seal recorded earlier in the session.
   *
   * @param {Iterable<string>} ids
   */
  add(ids) {
    const next = new Set(this.#ids);
    let changed = false;

    for (const id of ids) {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    }

    // Only notify on a real change: an export that sealed nothing new should
    // not cause a render, and a no-op notification is how render loops start.
    if (!changed) return;

    this.#ids = next;
    this.#notify();
  }

  /**
   * @param {() => void} listener
   * @returns {() => void} Unsubscribe. Returned rather than requiring a
   *          matching `off` call, so a React effect can return it directly and
   *          cannot forget to clean up.
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    // Copied before iterating: a listener that unsubscribes itself while being
    // called would otherwise mutate the set mid-iteration.
    for (const listener of [...this.#listeners]) listener();
  }
}
