/**
 * One line of the punch list: a markup, reduced to what a schedule needs.
 *
 * ===========================================================================
 * WHY A SEPARATE TYPE AND NOT JUST THE ANNOTATION
 * ===========================================================================
 * A schedule needs a number, a place, a description and a state. A `Pin` has
 * all four, but it also has a PdfPoint, an id, a sheet id and a kind — and the
 * page writer has no business with any of those. Handing it the annotation
 * would let it reach for geometry, and the first time someone did, the schedule
 * would quietly depend on pins being the only thing in it.
 *
 * This is the narrow waist. A markup type contributes entries by registering a
 * builder (see PunchListRegistry); the writer only ever sees these four fields.
 * A photograph or an RFI could be scheduled tomorrow without the writer
 * changing at all, because there is nothing type-specific left in it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NUMBER IS PASSED IN RATHER THAN DERIVED
 * ---------------------------------------------------------------------------
 * The number on the schedule and the number inside the pin on the drawing have
 * to be the same number, or the schedule is worse than useless — it points at
 * the wrong thing. So it is assigned once, for the whole document, and given to
 * both the writer and this entry. See `assignOrdinals`.
 */
export class PunchListEntry {
  /**
   * @param {object} fields
   * @param {number} fields.number     Matches the number drawn in the pin.
   * @param {number} fields.pageIndex  Zero-based; the schedule prints it 1-based.
   * @param {string} fields.description What the item actually is.
   * @param {string} fields.status     A human-readable state, already formatted.
   * @param {string} [fields.statusKey] A STABLE token for the same state, used
   *        to colour the row. Separate from `status` because the printed
   *        wording is free to change — and to be translated — without silently
   *        changing what colour something is. A token the writer does not
   *        recognise simply prints in the neutral colour.
   * @param {Date} fields.createdAt    When it was raised.
   */
  constructor({ number, pageIndex, description, status, statusKey, createdAt }) {
    this.number = number;
    this.pageIndex = pageIndex;
    // An empty description is the normal case for an item raised in a hurry and
    // not yet written up. It is recorded honestly rather than hidden, because a
    // blank row on the schedule is exactly the prompt someone needs.
    this.description = typeof description === 'string' ? description.trim() : '';
    this.status = status;
    this.statusKey = statusKey ?? String(status).toLowerCase().replace(/\s+/g, '_');
    this.createdAt = createdAt;
    Object.freeze(this);
  }

  /** The sheet as a person refers to it. */
  get sheetLabel() {
    return `Sheet ${this.pageIndex + 1}`;
  }

  /** ISO date, no time. A punch list is a day-resolution document. */
  get raisedOn() {
    return this.createdAt instanceof Date && !Number.isNaN(this.createdAt.valueOf())
      ? this.createdAt.toISOString().slice(0, 10)
      : '';
  }

  /** What the schedule prints when nobody wrote anything down. */
  get descriptionForPrint() {
    return this.description || '(no description)';
  }
}
