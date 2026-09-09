/**
 * A coordinate expressed in **CSS viewport space**: pixels measured from the
 * top-left corner of the rendered canvas, Y increasing downward.
 *
 * This is what a browser event gives you. It is meaningful only for one
 * specific combination of zoom, rotation and device pixel ratio, so it is
 * **never persisted** and never crosses a repository boundary. It exists just
 * long enough to be converted into a PdfPoint.
 *
 * ---------------------------------------------------------------------------
 * CSS PIXELS vs BITMAP PIXELS — the retina trap
 * ---------------------------------------------------------------------------
 * A canvas has two different sizes:
 *
 *   the CSS box      `getBoundingClientRect()`  — how big it looks
 *   the bitmap       `canvas.width` / `.height` — how many pixels it stores
 *
 * On a retina display they differ by `devicePixelRatio`: 1.5x, 2x or 3x. An
 * iPad is always retina.
 *
 * pdf.js's coordinate conversion expects **CSS pixels**. Feeding it bitmap
 * pixels produces coordinates wrong by exactly that ratio — correct on a
 * non-retina laptop, wrong on every tablet, which is the one device this
 * feature is being built for.
 *
 * `fromPointerEvent` below is the safe construction path and always yields CSS
 * pixels. Prefer it over doing the subtraction by hand, and never build a
 * ViewportPoint out of `canvas.width`.
 */
export class ViewportPoint {
  /**
   * @param {number} x Pixels from the canvas's left edge (CSS pixels).
   * @param {number} y Pixels from the canvas's TOP edge (CSS pixels).
   */
  constructor(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(`ViewportPoint requires finite coordinates, received (${x}, ${y}).`);
    }

    this.x = x;
    this.y = y;
    Object.freeze(this);
  }

  /**
   * Builds a ViewportPoint from a pointer event, relative to an element.
   *
   * Always produces CSS pixels, because `getBoundingClientRect()` is itself in
   * CSS pixels. Use this instead of `event.offsetX` (relative to whatever node
   * was hit, which may be a child marker rather than the canvas) or
   * `event.layerX` (deprecated and inconsistent between browsers).
   *
   * @param {{ clientX: number, clientY: number }} event
   * @param {Element} element The canvas or an overlay laid exactly over it.
   * @returns {ViewportPoint}
   */
  static fromPointerEvent(event, element) {
    const rect = element.getBoundingClientRect();
    return new ViewportPoint(event.clientX - rect.left, event.clientY - rect.top);
  }

  toString() {
    return `ViewportPoint(${this.x.toFixed(1)}, ${this.y.toFixed(1)})`;
  }
}
