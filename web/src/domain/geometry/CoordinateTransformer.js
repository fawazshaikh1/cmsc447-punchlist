import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * CONTRACT (abstract base class).
 *
 * Converts between screen space and PDF user space for one specific rendering
 * of one specific page — that is, for one combination of page, zoom and
 * rotation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A CONTRACT RATHER THAN A CONCRETE CLASS
 * ---------------------------------------------------------------------------
 * The maths is delegated to pdf.js, which already handles the Y-axis flip, the
 * scale factor and all four page rotations correctly and is exercised by every
 * Firefox user on earth. But the domain tier must not import pdf.js, because:
 *
 *   - Domain rules stay testable with a ten-line fake transformer, no PDF
 *     fixture and no browser.
 *   - Swapping the render engine, or moving export to a Node worker in
 *     Sprint 3, means writing one new adapter rather than editing domain code.
 *
 * The concrete implementation lives in `infrastructure/pdf/`.
 *
 * ---------------------------------------------------------------------------
 * LIFETIME — read this before caching one
 * ---------------------------------------------------------------------------
 * A transformer is valid ONLY for the scale and rotation it was created with.
 * Zooming or rotating must produce a NEW transformer. Holding on to one across
 * a zoom is the classic way to make placement subtly wrong, so `scale` and
 * `rotation` are read-only properties rather than setters — an immutable
 * transformer cannot go stale without somebody noticing.
 */
export class CoordinateTransformer {
  /** Methods a concrete transformer must provide. @see enforceContract */
  static REQUIRED = ['toPdfPoint', 'toViewportPoint', 'getScale', 'getRotation', 'getCssSize'];

  constructor() {
    enforceContract(this, new.target, CoordinateTransformer);
  }

  /**
   * Screen -> document. Call this on every click, before storing anything.
   *
   * @param {import('./ViewportPoint').ViewportPoint} point
   *        Must be CSS pixels — build it with `ViewportPoint.fromPointerEvent`.
   * @returns {import('./PdfPoint').PdfPoint}
   */
  toPdfPoint(point) {
    return abstractMethod('CoordinateTransformer', 'toPdfPoint', point);
  }

  /**
   * Document -> screen, in CSS pixels. Used for hit-testing and diagnostics.
   *
   * Note that the SVG annotation overlay does NOT need this: its `viewBox` is
   * already in PDF points, so the browser performs that transform natively.
   *
   * @param {import('./PdfPoint').PdfPoint} point
   * @returns {import('./ViewportPoint').ViewportPoint}
   */
  toViewportPoint(point) {
    return abstractMethod('CoordinateTransformer', 'toViewportPoint', point);
  }

  /** @returns {number} The zoom factor this transformer was built for. 1 = 100%. */
  getScale() {
    return abstractMethod('CoordinateTransformer', 'getScale');
  }

  /** @returns {number} Total rotation in degrees applied to the page. */
  getRotation() {
    return abstractMethod('CoordinateTransformer', 'getRotation');
  }

  /**
   * Rendered page size in CSS pixels at the current scale.
   * NOT the canvas bitmap size — see ViewportPoint for why that distinction
   * matters.
   * @returns {{ width: number, height: number }}
   */
  getCssSize() {
    return abstractMethod('CoordinateTransformer', 'getCssSize');
  }
}
