/**
 * A coordinate expressed in **PDF user space**.
 *
 * PDF user space has its origin at the BOTTOM-LEFT of the page, Y increases
 * upward, and one unit is 1/72 inch (a "point"). A US-Letter page is therefore
 * 612 x 792 points no matter how it is displayed.
 *
 * This is the ONLY coordinate space this application ever persists. It is
 * independent of zoom, device pixel ratio, page rotation and screen size, which
 * means a pin dropped on an iPad at 300% zoom lands in exactly the same place
 * when reopened on a laptop at 50% zoom — and lands correctly again when the
 * sheet is eventually exported back out as a PDF file.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A CLASS AND NOT A PLAIN `{ x, y }` OBJECT
 * ---------------------------------------------------------------------------
 * A screen coordinate and a document coordinate are both two numbers, so plain
 * objects make them interchangeable — and swapping them is the most expensive
 * mistake available in this project. It does not throw. It works on a
 * non-retina laptop. It shows up weeks later as "the pins are in the wrong
 * place on the iPad" and takes days to trace.
 *
 * Making each space its own class means `assertInstanceOf` can reject the wrong
 * one at every boundary, so the mistake becomes a loud error on the first click
 * instead of a silent wrong answer in week three.
 */
export class PdfPoint {
  /**
   * @param {number} x Horizontal position in points, from the left page edge.
   * @param {number} y Vertical position in points, from the BOTTOM page edge.
   */
  constructor(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(`PdfPoint requires finite coordinates, received (${x}, ${y}).`);
    }

    this.x = x;
    this.y = y;

    // Value objects are immutable: a coordinate that can be edited in place can
    // be edited by accident, and a stale mutation is exactly the kind of bug
    // this class exists to prevent. Freezing also means React can compare by
    // reference without defensive copying.
    Object.freeze(this);
  }

  /**
   * Structural equality with a tolerance, for tests and round-trip checks.
   * @param {PdfPoint} other
   * @param {number} [epsilonPts] Default 0.01pt, roughly 1/7000 inch.
   * @returns {boolean}
   */
  equals(other, epsilonPts = 0.01) {
    return (
      other instanceof PdfPoint &&
      Math.abs(this.x - other.x) < epsilonPts &&
      Math.abs(this.y - other.y) < epsilonPts
    );
  }

  /**
   * Serialised form — flat and primitive so it maps 1:1 onto a Postgres row
   * and onto the Go API's JSON.
   * @returns {{ x: number, y: number }}
   */
  toJSON() {
    return { x: this.x, y: this.y };
  }

  /**
   * @param {{ x: number, y: number }} raw
   * @returns {PdfPoint}
   */
  static fromJSON(raw) {
    return new PdfPoint(raw.x, raw.y);
  }

  toString() {
    return `PdfPoint(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`;
  }
}
