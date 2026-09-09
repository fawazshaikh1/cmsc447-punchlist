import { PdfPoint } from '../../domain/geometry/PdfPoint';
import { ViewportPoint } from '../../domain/geometry/ViewportPoint';
import { CoordinateTransformer } from '../../domain/geometry/CoordinateTransformer';
import { assertInstanceOf, COORDINATE_SPACE_HINT } from '../../domain/support/contracts';

/**
 * CoordinateTransformer backed by a pdf.js viewport. TIER 3.
 *
 * ---------------------------------------------------------------------------
 * WHY DELEGATE THE MATHS INSTEAD OF DOING IT OURSELVES
 * ---------------------------------------------------------------------------
 * The transform is a 2D affine matrix, so reimplementing it is maybe fifteen
 * lines. We deliberately do not, because those fifteen lines have to be right
 * for all four page rotations, for pages whose MediaBox origin is not (0,0),
 * and for the Y-axis flip — and pdf.js's version is exercised by every Firefox
 * user on the planet. Delegating deletes an entire category of subtle,
 * hard-to-reproduce placement bugs from our codebase.
 *
 * The wrapper still earns its keep. It is where CSS-pixel input is guaranteed,
 * where the PdfPoint / ViewportPoint guards are applied, and where the domain's
 * dependency on pdf.js stops.
 *
 * ---------------------------------------------------------------------------
 * VERIFIED BEHAVIOUR (pdfjs-dist 6.3.289, 1224x792pt page)
 *   screen (100,100) @2x   ->  PDF (50, 742)     Y flips: 792 - 100/2 = 742
 *   round-trip of any point returns the original exactly
 *   one PDF point maps to (200,150) @1x and (450,337.5) @2.25x
 *   rotating 90deg swaps the reported canvas size and maps coordinates through
 */
export class PdfJsCoordinateTransformer extends CoordinateTransformer {
  /**
   * @param {object} viewport A pdf.js PageViewport, from `page.getViewport()`.
   *        Not imported as a type: pdf.js does not export PageViewport as a
   *        public constructor, and the four members we use are a small enough
   *        surface to depend on directly.
   */
  constructor(viewport) {
    super();
    this.viewport = viewport;
  }

  /** @returns {number} */
  getScale() {
    return this.viewport.scale;
  }

  /** @returns {number} Total rotation applied, in degrees. */
  getRotation() {
    return this.viewport.rotation;
  }

  /**
   * Rendered size in CSS pixels.
   *
   * NOT the canvas bitmap size, which is this multiplied by devicePixelRatio.
   * Confusing the two is the retina bug documented on ViewportPoint.
   *
   * @returns {{ width: number, height: number }}
   */
  getCssSize() {
    return { width: this.viewport.width, height: this.viewport.height };
  }

  /**
   * Screen -> document.
   *
   * @param {ViewportPoint} point Must be CSS pixels relative to the canvas's
   *        top-left corner. Build it with `ViewportPoint.fromPointerEvent`.
   * @returns {PdfPoint}
   */
  toPdfPoint(point) {
    // Runtime replacement for a compile-time type check. Handing this a
    // PdfPoint — double-converting a coordinate — is a real and easy mistake,
    // and one that produces plausible-looking but wrong numbers rather than an
    // obvious failure. Catch it here, loudly, at the boundary.
    assertInstanceOf(point, ViewportPoint, 'point', COORDINATE_SPACE_HINT);

    const [x, y] = this.viewport.convertToPdfPoint(point.x, point.y);
    return new PdfPoint(x, y);
  }

  /**
   * Document -> screen, in CSS pixels.
   * @param {PdfPoint} point
   * @returns {ViewportPoint}
   */
  toViewportPoint(point) {
    assertInstanceOf(point, PdfPoint, 'point', COORDINATE_SPACE_HINT);

    const [x, y] = this.viewport.convertToViewportPoint(point.x, point.y);
    return new ViewportPoint(x, y);
  }
}
