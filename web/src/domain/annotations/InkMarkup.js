import { PdfPoint } from '../geometry/PdfPoint';
import { assertInstanceOf, COORDINATE_SPACE_HINT } from '../support/contracts';
import { Annotation } from './Annotation';
import { AnnotationRegistry } from './AnnotationRegistry';
import { MarkupStyle } from './MarkupStyle';

export const INK_KIND = 'ink';

/**
 * A freehand stroke — what a finger or stylus draws on a tablet.
 *
 * Does NOT extend TwoPointMarkup: it is defined by an arbitrary-length path
 * rather than two corners, and its interaction samples continuously during the
 * drag rather than tracking a single moving endpoint. Forcing it into that
 * hierarchy would mean a base class whose "two points" were meaningless for one
 * of its subclasses, which is the classic sign that the inheritance is wrong.
 *
 * It exports to a native PDF `/Ink` annotation, whose `/InkList` is literally a
 * list of paths in page coordinates — an almost exact match for what we store,
 * so nothing is approximated in the round trip.
 */
export class InkMarkup extends Annotation {
  /**
   * @param {string} id
   * @param {string} sheetId
   * @param {PdfPoint[]} points Path in PDF user space, in stroke order.
   * @param {MarkupStyle} style
   * @param {Date} createdAt
   */
  constructor(id, sheetId, points, style, createdAt) {
    super(id, sheetId, createdAt);

    if (!Array.isArray(points) || points.length === 0) {
      throw new RangeError('InkMarkup requires at least one point.');
    }
    // Guard every point, not just the first. A path assembled from mixed
    // coordinate spaces would render as a plausible-looking but wrong squiggle,
    // which is far harder to spot than an obvious failure.
    points.forEach((point, index) =>
      assertInstanceOf(point, PdfPoint, `ink point [${index}]`, COORDINATE_SPACE_HINT),
    );
    assertInstanceOf(style, MarkupStyle, 'markup style');

    this.points = Object.freeze([...points]);
    this.style = style;
    Object.freeze(this);
  }

  getKind() {
    return INK_KIND;
  }

  /** Anchor is the first point of the stroke. @returns {PdfPoint} */
  getAnchor() {
    return this.points[0];
  }

  /**
   * Axis-aligned bounding box of the whole stroke, in PDF user space.
   * Needed for the exported annotation's `/Rect`, which must enclose the ink.
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  getBounds() {
    const xs = this.points.map((p) => p.x);
    const ys = this.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  }

  /**
   * A single tap produces a one- or two-point "stroke" that renders as nothing.
   * Tools discard these rather than storing invisible artefacts that clutter
   * the annotation list and the export.
   * @returns {boolean}
   */
  isDegenerate() {
    return this.points.length < 3;
  }

  /**
   * Translates every point in the stroke.
   * @param {number} dxPts @param {number} dyPts @returns {InkMarkup}
   */
  movedBy(dxPts, dyPts) {
    return new InkMarkup(
      this.id,
      this.sheetId,
      this.points.map((point) => new PdfPoint(point.x + dxPts, point.y + dyPts)),
      this.style,
      this.createdAt,
    );
  }

  serializePayload() {
    // Stored as a flat number array rather than an array of {x,y} objects:
    // roughly half the JSON size for a long stroke, and it matches the shape
    // the PDF `/InkList` entry wants, so the exporter needs no restructuring.
    const path = [];
    for (const point of this.points) path.push(point.x, point.y);
    return { path, style: this.style.toJSON() };
  }

  /** @param {object} dto @returns {InkMarkup} */
  static fromJSON(dto) {
    const payload = dto.payload ?? {};
    const flat = Array.isArray(payload.path) ? payload.path : [];

    const points = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      points.push(new PdfPoint(Number(flat[i]), Number(flat[i + 1])));
    }

    // A stroke that lost its path in storage still has its anchor in the
    // top-level x/y columns, so it can be reconstructed as a degenerate dot
    // rather than throwing and taking the whole sheet down with it.
    if (points.length === 0) points.push(new PdfPoint(dto.x, dto.y));

    return new InkMarkup(
      dto.id,
      dto.sheetId,
      points,
      MarkupStyle.fromJSON(payload.style),
      new Date(dto.createdAt),
    );
  }
}

AnnotationRegistry.register(INK_KIND, InkMarkup.fromJSON);
