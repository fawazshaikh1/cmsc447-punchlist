/**
 * Visual style shared by every markup type: stroke colour and weight.
 *
 * ---------------------------------------------------------------------------
 * WHY A VALUE OBJECT RATHER THAN TWO LOOSE FIELDS ON EACH MARKUP
 * ---------------------------------------------------------------------------
 * Every markup type needs the same two properties, and every one of them has to
 * serialise them, validate them, and hand them to the PDF exporter. Putting
 * that in one place means:
 *
 *   - validation is written once, not six times
 *   - the export writers can accept a MarkupStyle regardless of markup type
 *   - adding a third property (opacity, dash pattern) touches ONE file rather
 *     than every markup class
 *
 * That last point is the "add, don't modify" property applied at the smallest
 * scale, and it is why this is a class rather than an inline `{ color, width }`.
 *
 * COLOUR FORMAT: `#rrggbb`. Stored as a string because that is what CSS and SVG
 * want, and what survives a JSON round-trip through the Go API unambiguously.
 * `toRgbFractions()` converts to the 0..1 triple the PDF format requires — the
 * one place that conversion is allowed to happen.
 */
export class MarkupStyle {
  /** Construction markup convention: red means "issue found here". */
  static DEFAULT_COLOR = '#e8342a';

  /** Stroke weight in PDF points, so markups scale with the drawing. */
  static DEFAULT_WIDTH = 2;

  /**
   * @param {string} [color] Hex colour, `#rrggbb`.
   * @param {number} [strokeWidth] Stroke weight in PDF points.
   */
  constructor(color = MarkupStyle.DEFAULT_COLOR, strokeWidth = MarkupStyle.DEFAULT_WIDTH) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new RangeError(`MarkupStyle colour must be #rrggbb, received "${color}".`);
    }
    if (!(strokeWidth > 0)) {
      throw new RangeError(`MarkupStyle strokeWidth must be positive, received ${strokeWidth}.`);
    }

    this.color = color.toLowerCase();
    this.strokeWidth = strokeWidth;
    Object.freeze(this);
  }

  /**
   * Colour as the 0..1 RGB triple the PDF format uses in its `/C` entry.
   *
   * PDF colour operators are fractions, not bytes — `1 0 0` is red, not
   * `255 0 0`. Getting this wrong produces black annotations with no error,
   * so the conversion lives here and nowhere else.
   *
   * @returns {[number, number, number]}
   */
  toRgbFractions() {
    return [
      parseInt(this.color.slice(1, 3), 16) / 255,
      parseInt(this.color.slice(3, 5), 16) / 255,
      parseInt(this.color.slice(5, 7), 16) / 255,
    ];
  }

  /** @returns {{ color: string, strokeWidth: number }} */
  toJSON() {
    return { color: this.color, strokeWidth: this.strokeWidth };
  }

  /**
   * Rebuilds from stored form, tolerating missing or malformed values.
   *
   * Defensive because this comes off the wire: a hand-edited row or an older
   * client should degrade to the default style rather than fail to load the
   * sheet it belongs to.
   *
   * @param {unknown} raw
   * @returns {MarkupStyle}
   */
  static fromJSON(raw) {
    const color =
      typeof raw?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)
        ? raw.color
        : MarkupStyle.DEFAULT_COLOR;

    const strokeWidth =
      typeof raw?.strokeWidth === 'number' && raw.strokeWidth > 0
        ? raw.strokeWidth
        : MarkupStyle.DEFAULT_WIDTH;

    return new MarkupStyle(color, strokeWidth);
  }
}
