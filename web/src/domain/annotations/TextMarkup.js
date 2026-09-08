import { PdfPoint } from '../geometry/PdfPoint';
import { assertInstanceOf, COORDINATE_SPACE_HINT } from '../support/contracts';
import { Annotation } from './Annotation';
import { AnnotationRegistry } from './AnnotationRegistry';
import { MarkupStyle } from './MarkupStyle';

export const TEXT_KIND = 'text';

/** Default type size in PDF points — 12pt reads correctly on a printed sheet. */
const DEFAULT_FONT_SIZE = 12;

/**
 * A free-standing text callout placed directly on the drawing.
 *
 * Distinct from a Pin's description: a pin is a tracked punch ITEM with a
 * status and an assignee, whereas this is just writing on the drawing —
 * "verify dimension", "typ. of 4". Conflating them would mean every scribbled
 * note appears in the punch-item report and inflates the count the client sees.
 *
 * Exports to a native PDF `/FreeText` annotation.
 */
export class TextMarkup extends Annotation {
  /**
   * @param {string} id
   * @param {string} sheetId
   * @param {PdfPoint} position Baseline start of the text, in PDF user space.
   * @param {string} text
   * @param {number} fontSize In PDF points.
   * @param {MarkupStyle} style
   * @param {Date} createdAt
   */
  constructor(id, sheetId, position, text, fontSize, style, createdAt) {
    super(id, sheetId, createdAt);

    assertInstanceOf(position, PdfPoint, 'text position', COORDINATE_SPACE_HINT);
    assertInstanceOf(style, MarkupStyle, 'markup style');

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new RangeError('TextMarkup requires non-empty text.');
    }
    if (!(fontSize > 0)) {
      throw new RangeError(`TextMarkup fontSize must be positive, received ${fontSize}.`);
    }

    this.position = position;
    this.text = text;
    this.fontSize = fontSize;
    this.style = style;
    Object.freeze(this);
  }

  getKind() {
    return TEXT_KIND;
  }

  /** @returns {PdfPoint} */
  getAnchor() {
    return this.position;
  }

  /** Line spacing as a multiple of font size. Shared by both renderers. */
  static LINE_HEIGHT_RATIO = 1.2;

  /**
   * Approximate bounding box, in PDF user space.
   *
   * =========================================================================
   * THE ANCHOR IS THE TOP-LEFT OF THE TEXT BLOCK, NOT THE FIRST BASELINE
   * =========================================================================
   * BUG THIS FIXES (found in real use): the anchor used to be the baseline, so
   * glyphs extended UPWARD from where the user tapped. Placing a callout near
   * the top of a sheet pushed it off the page and it rendered clipped in half.
   *
   * Treating the anchor as the top-left means text flows DOWN and to the right
   * from the tap — which is what every other tool does and what a user expects.
   * Both renderers must agree: `TextMarker` drops its first baseline by one
   * font size, and `textWriter` does the same in the exported appearance
   * stream.
   *
   * The 0.55 width factor is an average advance width for a proportional font.
   * It is an ESTIMATE by design: measuring properly needs font metrics, which
   * would drag a font library into the domain tier for a box that only has to
   * be roughly right. Its consumers are the exported `/Rect` (which Acrobat
   * refits to the real text anyway) and hit-testing.
   *
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  getBounds() {
    const lines = this.text.split('\n');
    const longest = Math.max(...lines.map((line) => line.length));
    const height = this.fontSize * TextMarkup.LINE_HEIGHT_RATIO * lines.length;

    return {
      x: this.position.x,
      // Anchor is the TOP edge, so the box extends downward — which in PDF
      // user space, where Y increases upward, means subtracting the height.
      y: this.position.y - height,
      width: Math.max(longest * this.fontSize * 0.55, this.fontSize),
      height,
    };
  }

  /** @param {number} dxPts @param {number} dyPts @returns {TextMarkup} */
  movedBy(dxPts, dyPts) {
    return new TextMarkup(
      this.id,
      this.sheetId,
      new PdfPoint(this.position.x + dxPts, this.position.y + dyPts),
      this.text,
      this.fontSize,
      this.style,
      this.createdAt,
    );
  }

  /** Returns a copy with new text. The original is untouched. */
  withText(text) {
    return new TextMarkup(
      this.id, this.sheetId, this.position, text, this.fontSize, this.style, this.createdAt,
    );
  }

  serializePayload() {
    return { text: this.text, fontSize: this.fontSize, style: this.style.toJSON() };
  }

  /** @param {object} dto @returns {TextMarkup} */
  static fromJSON(dto) {
    const payload = dto.payload ?? {};
    return new TextMarkup(
      dto.id,
      dto.sheetId,
      new PdfPoint(dto.x, dto.y),
      typeof payload.text === 'string' && payload.text.trim() ? payload.text : '(empty)',
      typeof payload.fontSize === 'number' && payload.fontSize > 0
        ? payload.fontSize
        : DEFAULT_FONT_SIZE,
      MarkupStyle.fromJSON(payload.style),
      new Date(dto.createdAt),
    );
  }

  static get DEFAULT_FONT_SIZE() {
    return DEFAULT_FONT_SIZE;
  }
}

AnnotationRegistry.register(TEXT_KIND, TextMarkup.fromJSON);
