import { PdfPoint } from '../geometry/PdfPoint';
import { assertInstanceOf, COORDINATE_SPACE_HINT } from '../support/contracts';
import { Annotation } from './Annotation';
import { MarkupStyle } from './MarkupStyle';

/**
 * Abstract base for any markup defined by two dragged points.
 *
 * Three concrete types share this shape and this drag interaction:
 *
 *   RectangleMarkup   corner -> opposite corner
 *   CloudMarkup       corner -> opposite corner, drawn with a cloudy border
 *   ArrowMarkup       tail -> head (DIRECTIONAL: the two points are not
 *                     interchangeable, unlike the other two)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LAYER OF INHERITANCE EXISTS
 * ---------------------------------------------------------------------------
 * Without it, each of those three would repeat the same start/end validation,
 * the same style handling, the same serialisation and the same
 * `TwoPointTool` wiring — four near-identical copies that drift apart the first
 * time somebody fixes a bug in only one of them.
 *
 * With it, a fourth two-point markup (an ellipse, a dimension line, a
 * measurement) is a subclass declaring its `getKind()` and its payload extras.
 * The drag tool, the bounds maths and the persistence all come for free.
 *
 * NOTE: `getBounds()` NORMALISES, so a rectangle dragged bottom-right to
 * top-left is identical to one dragged the other way. `start`/`end` are kept
 * unnormalised because ArrowMarkup needs to know which end is the head.
 */
export class TwoPointMarkup extends Annotation {
  /**
   * @param {string} id
   * @param {string} sheetId
   * @param {PdfPoint} start Where the drag began, in PDF user space.
   * @param {PdfPoint} end   Where the drag ended, in PDF user space.
   * @param {MarkupStyle} style
   * @param {Date} createdAt
   */
  constructor(id, sheetId, start, end, style, createdAt) {
    super(id, sheetId, createdAt);

    assertInstanceOf(start, PdfPoint, 'markup start', COORDINATE_SPACE_HINT);
    assertInstanceOf(end, PdfPoint, 'markup end', COORDINATE_SPACE_HINT);
    assertInstanceOf(style, MarkupStyle, 'markup style');

    this.start = start;
    this.end = end;
    this.style = style;
  }

  /**
   * Anchor is the drag origin. Generic code — sorting, "jump to this markup",
   * culling to the visible region — uses this without knowing the subtype.
   * @returns {PdfPoint}
   */
  getAnchor() {
    return this.start;
  }

  /**
   * Axis-aligned bounding box in PDF user space, normalised so `x`/`y` is
   * always the bottom-left corner regardless of drag direction.
   *
   * This is what both the SVG renderer and the PDF exporter want: SVG needs a
   * positive width/height, and a PDF `/Rect` entry is required by the spec to
   * be given as lower-left then upper-right.
   *
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  getBounds() {
    return {
      x: Math.min(this.start.x, this.end.x),
      y: Math.min(this.start.y, this.end.y),
      width: Math.abs(this.end.x - this.start.x),
      height: Math.abs(this.end.y - this.start.y),
    };
  }

  /**
   * True when the drag was so small it was almost certainly a stray tap rather
   * than an intentional markup. Tools use this to discard accidental
   * zero-size shapes instead of littering the sheet with invisible artefacts.
   *
   * The threshold is in PDF points, so it is a constant physical size on the
   * drawing rather than varying with zoom — a 3pt drag is a slip at any
   * magnification.
   *
   * @param {number} [minimumPts]
   * @returns {boolean}
   */
  isDegenerate(minimumPts = 3) {
    const { width, height } = this.getBounds();
    return width < minimumPts && height < minimumPts;
  }

  /**
   * Translates both points, which moves the whole shape rigidly.
   *
   * Implemented once here and inherited by rectangle, cloud and arrow —
   * including the arrow, whose head and tail must move together or it would
   * change direction as it is dragged.
   *
   * Uses `this.constructor` so a subclass gets back its own type rather than a
   * TwoPointMarkup. Every subclass shares the same constructor signature, which
   * is enforced by them all being built through `TwoPointTool.createMarkup`.
   *
   * @param {number} dxPts @param {number} dyPts @returns {TwoPointMarkup}
   */
  /**
   * A copy scaled about its START point.
   *
   * =========================================================================
   * ONE METHOD, THREE MARKUP TYPES
   * =========================================================================
   * Box, revision cloud and arrow are all two-point shapes, so all three gain
   * resizing from this one implementation — and a fourth two-point type would
   * too, without touching anything.
   *
   * Scaled about `start` rather than the centre because `start` is where the
   * user pressed. An arrow in particular MEANS something at its tail: growing
   * it about the centre would walk the head off whatever it is pointing at.
   *
   * `this.constructor` for the same reason `movedBy` uses it — a subclass gets
   * back its own type rather than a TwoPointMarkup.
   *
   * @param {number} factor
   */
  scaledBy(factor) {
    return new this.constructor(
      this.id,
      this.sheetId,
      this.start,
      new PdfPoint(
        this.start.x + (this.end.x - this.start.x) * factor,
        this.start.y + (this.end.y - this.start.y) * factor,
      ),
      this.style,
      this.createdAt,
    );
  }

  movedBy(dxPts, dyPts) {
    return new this.constructor(
      this.id,
      this.sheetId,
      new PdfPoint(this.start.x + dxPts, this.start.y + dyPts),
      new PdfPoint(this.end.x + dxPts, this.end.y + dyPts),
      this.style,
      this.createdAt,
    );
  }

  /**
   * Shared payload for every two-point markup. Subclasses that need extra
   * fields override this and spread the result in:
   *
   *     serializePayload() {
   *       return { ...super.serializePayload(), myExtraField: this.thing };
   *     }
   *
   * @returns {Record<string, unknown>}
   */
  serializePayload() {
    return {
      endX: this.end.x,
      endY: this.end.y,
      style: this.style.toJSON(),
    };
  }

  /**
   * Shared constructor-argument extraction for subclass `fromJSON` methods.
   *
   * Subclasses call this rather than repeating the same six lines:
   *
   *     static fromJSON(dto) { return new MyMarkup(...TwoPointMarkup.argsFromJSON(dto)); }
   *
   * @param {object} dto
   * @returns {[string, string, PdfPoint, PdfPoint, MarkupStyle, Date]}
   */
  static argsFromJSON(dto) {
    const payload = dto.payload ?? {};
    return [
      dto.id,
      dto.sheetId,
      new PdfPoint(dto.x, dto.y),
      new PdfPoint(Number(payload.endX), Number(payload.endY)),
      MarkupStyle.fromJSON(payload.style),
      new Date(dto.createdAt),
    ];
  }
}
