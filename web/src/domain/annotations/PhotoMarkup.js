import { Annotation } from './Annotation';
import { AnnotationRegistry } from './AnnotationRegistry';
import { MediaRef } from '../media/MediaRef';
import { PdfPoint } from '../geometry/PdfPoint';
import { assertInstanceOf, COORDINATE_SPACE_HINT } from '../support/contracts';

/** Registry discriminator. Exported so writers and markers never retype it. */
export const PHOTO_KIND = 'photo';

/** Default width on the sheet, in PDF points. About 2.2 inches. */
const DEFAULT_WIDTH_PTS = 160;

/** Guard rails on resize, so a photo can never swallow or vanish from a sheet. */
const MIN_WIDTH_PTS = 48;
const MAX_WIDTH_PTS = 1200;

/**
 * A photograph placed on the drawing.
 *
 * ===========================================================================
 * THE SEVENTH MARKUP TYPE, AND WHAT IT COST
 * ===========================================================================
 * Four files and four registration lines, exactly as ARCHITECTURE.md claims:
 * this class, a marker component, a tool, and a PDF writer. No existing
 * annotation type, service, repository, overlay or panel was edited to make
 * photos work.
 *
 * It is the first type that needed something genuinely new — a place to put
 * bytes — and that turned out to be a new port rather than a change to any
 * existing one. See MediaStore.
 *
 * ---------------------------------------------------------------------------
 * ANCHOR IS THE TOP-LEFT CORNER
 * ---------------------------------------------------------------------------
 * Same convention as TextMarkup, and for the same reason: the user taps where
 * they want the thing to START, and PDF's Y axis points up while the reading
 * order of an image goes down. Anchoring at the visual top-left means what they
 * tapped is what they get, at every rotation.
 *
 * ---------------------------------------------------------------------------
 * WHY HEIGHT IS DERIVED AND WIDTH IS STORED
 * ---------------------------------------------------------------------------
 * Storing both invites them to disagree — a resize that updates one and not the
 * other produces a stretched photograph, and nothing in the model would object.
 * The aspect ratio belongs to the image, so height is always computed from it.
 * Resizing is therefore a single number, and it cannot distort.
 */
export class PhotoMarkup extends Annotation {
  /**
   * @param {string} id
   * @param {string} sheetId
   * @param {PdfPoint} position Top-left corner, in PDF user space.
   * @param {MediaRef} media Pointer to the stored bytes.
   * @param {string} caption What the photo shows. Optional but encouraged.
   * @param {number} widthPts On-sheet width. Height follows the aspect ratio.
   * @param {Date} createdAt
   */
  constructor(id, sheetId, position, media, caption, widthPts, createdAt) {
    super(id, sheetId, createdAt);

    assertInstanceOf(position, PdfPoint, 'photo position', COORDINATE_SPACE_HINT);
    assertInstanceOf(media, MediaRef, 'photo media');

    this.position = position;
    this.media = media;
    this.caption = typeof caption === 'string' ? caption : '';

    // Clamped rather than rejected: a bad width is a display preference, and
    // refusing to reconstruct a stored annotation over one would lose the
    // user's photograph to a rounding error.
    this.widthPts = Number.isFinite(widthPts)
      ? Math.min(MAX_WIDTH_PTS, Math.max(MIN_WIDTH_PTS, widthPts))
      : DEFAULT_WIDTH_PTS;

    Object.freeze(this);
  }

  getKind() {
    return PHOTO_KIND;
  }

  getAnchor() {
    return this.position;
  }

  /** On-sheet height in points, from the image's own aspect ratio. */
  get heightPts() {
    return this.widthPts * this.media.aspectRatio;
  }

  /**
   * The rectangle this photo occupies, in PDF user space.
   *
   * Y DECREASES downward from the anchor because PDF's origin is bottom-left
   * and the anchor is the photo's TOP-left. Getting this backwards puts every
   * photograph one full height above where the user tapped — which looks
   * correct on a square test image and wrong on everything else.
   */
  getBounds() {
    const { x, y } = this.position;
    return {
      left: x,
      bottom: y - this.heightPts,
      right: x + this.widthPts,
      top: y,
      width: this.widthPts,
      height: this.heightPts,
    };
  }

  /**
   * The same rectangle as `getBounds`, but as PdfPoints.
   *
   * =========================================================================
   * WHY BOTH SHAPES EXIST
   * =========================================================================
   * They serve two callers with opposite needs, and collapsing them would make
   * one of them wrong.
   *
   * `getBounds` returns raw numbers because the PDF writer composes content
   * stream operators, which are numbers — wrapping them would only be unwrapped
   * again a line later.
   *
   * This returns PdfPoints because the SCREEN path must go through
   * `CoordinateTransformer.toViewportPoint`, which refuses anything that is not
   * one. That refusal is the whole point of the nominal typing: the first
   * version of PhotoMarker passed `{ x, y }` object literals and the guard threw
   * immediately, which is exactly the class of bug — screen and document
   * coordinates silently mixed — that the discipline exists to catch.
   *
   * @returns {{ topLeft: PdfPoint, bottomRight: PdfPoint }}
   */
  getCorners() {
    const bounds = this.getBounds();
    return {
      topLeft: new PdfPoint(bounds.left, bounds.top),
      bottomRight: new PdfPoint(bounds.right, bounds.bottom),
    };
  }

  serializePayload() {
    return {
      media: this.media.toJSON(),
      caption: this.caption,
      widthPts: this.widthPts,
    };
  }

  movedBy(dxPts, dyPts) {
    return new PhotoMarkup(
      this.id,
      this.sheetId,
      new PdfPoint(this.position.x + dxPts, this.position.y + dyPts),
      this.media,
      this.caption,
      this.widthPts,
      this.createdAt,
    );
  }

  /**
   * A described copy. Named to match TextMarkup's `withText` and Pin's
   * `withLabel`, because the properties panel branches on the CAPABILITY, not
   * on the type — implementing this is the whole cost of getting an editable
   * field in the panel.
   *
   * @param {string} caption
   */
  withCaption(caption) {
    return new PhotoMarkup(
      this.id,
      this.sheetId,
      this.position,
      this.media,
      caption,
      this.widthPts,
      this.createdAt,
    );
  }

  /**
   * A copy scaled about its anchor.
   *
   * =========================================================================
   * `scaledBy` IS THE RESIZE CAPABILITY
   * =========================================================================
   * The properties panel offers a size control to anything that implements
   * this, exactly as it offers a description box to anything with `withLabel`.
   * A markup type with no meaningful size — a pin — simply does not implement
   * it and no control appears. Nothing branches on type anywhere.
   *
   * Scaling is about the ANCHOR, not the centre, so a photo grows down and to
   * the right from the corner the user tapped. Growing about the centre would
   * move the thing they placed, which on a drawing means it no longer points at
   * the defect.
   *
   * @param {number} factor
   */
  scaledBy(factor) {
    return this.withWidth(this.widthPts * factor);
  }

  /** A resized copy. The aspect ratio is preserved because height is derived. */
  withWidth(widthPts) {
    return new PhotoMarkup(
      this.id,
      this.sheetId,
      this.position,
      this.media,
      this.caption,
      widthPts,
      this.createdAt,
    );
  }

  /**
   * Sensible on-sheet width for a freshly captured photo.
   *
   * Portrait photographs get a narrower box so a phone shot held vertically
   * does not run off the bottom of the sheet. Landscape gets the full default.
   */
  static defaultWidthFor(media) {
    return media.aspectRatio > 1.2 ? DEFAULT_WIDTH_PTS * 0.72 : DEFAULT_WIDTH_PTS;
  }

  /** @param {object} dto */
  static fromJSON(dto) {
    const payload = dto.payload ?? {};
    return new PhotoMarkup(
      dto.id,
      dto.sheetId,
      new PdfPoint(dto.x, dto.y),
      MediaRef.fromJSON(payload.media),
      payload.caption ?? '',
      payload.widthPts,
      new Date(dto.createdAt),
    );
  }
}

AnnotationRegistry.register(PHOTO_KIND, PhotoMarkup.fromJSON);
