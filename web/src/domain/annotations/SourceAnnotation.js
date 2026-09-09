/**
 * An annotation that was ALREADY in the uploaded PDF, before we touched it.
 *
 * ===========================================================================
 * WHY THIS IS NOT AN `Annotation`
 * ===========================================================================
 * These are the yellow sticky notes and boxes a reviewer sees in Chrome when
 * they open a drawing that someone has already commented on — and until now the
 * editor was blind to them. A user would open a sheet the architect had already
 * marked up, see a clean drawing, and re-raise issues that were already there.
 *
 * They are deliberately a SEPARATE type from our own `Annotation`, not a
 * seventh registered kind, for three reasons:
 *
 *   1. They are READ-ONLY. We did not create them and we cannot faithfully
 *      round-trip every PDF annotation type, so offering to edit one would be
 *      a promise we cannot keep.
 *   2. They must NOT be re-exported. They are already in the source file, and
 *      `PdfLibSheetExporter` copies the original bytes — writing them again
 *      would duplicate every existing comment on every export.
 *   3. They have no stable identity across reloads, so they cannot be selected,
 *      moved or undone in any meaningful way.
 *
 * Modelling them as a plain read-only value object keeps all three facts
 * structural rather than a set of rules someone has to remember.
 */
export class SourceAnnotation {
  /**
   * @param {object} spec
   * @param {string} spec.id
   * @param {string} spec.subtype PDF subtype, e.g. 'Text', 'Square'.
   * @param {{x:number,y:number,width:number,height:number}} spec.bounds
   *        In PDF user space — same space as everything else we store.
   * @param {string} spec.contents
   * @param {string} spec.author
   * @param {string|null} spec.color Hex, or null when the PDF gave none.
   */
  constructor({ id, subtype, bounds, contents = '', author = '', color = null }) {
    this.id = id;
    this.subtype = subtype;
    this.bounds = bounds;
    this.contents = contents;
    this.author = author;
    this.color = color;
    Object.freeze(this);
  }

  /**
   * True for the "sticky note" family, which viewers draw as an icon rather
   * than as a shape on the page. These are the little yellow boxes.
   * @returns {boolean}
   */
  isNote() {
    return this.subtype === 'Text' || this.subtype === 'FileAttachment';
  }

  /** Short summary for a tooltip. @returns {string} */
  describe() {
    const who = this.author ? `${this.author}: ` : '';
    const what = this.contents.trim() || `(${this.subtype} annotation, no text)`;
    return `${who}${what}`;
  }
}
