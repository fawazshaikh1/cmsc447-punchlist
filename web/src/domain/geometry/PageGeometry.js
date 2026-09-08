import { PdfPoint } from './PdfPoint';
import { assertInstanceOf, COORDINATE_SPACE_HINT } from '../support/contracts';

/**
 * Valid page rotations, in degrees. Frozen object rather than a bare string
 * union (which JavaScript has no way to express) so the allowed values live in
 * one place and can be referenced by name instead of retyped as literals.
 */
export const Rotation = Object.freeze({
  NONE: 0,
  QUARTER: 90,
  HALF: 180,
  THREE_QUARTER: 270,
});

/** @param {number} value @returns {boolean} */
export function isValidRotation(value) {
  return Object.values(Rotation).includes(value);
}

/**
 * The intrinsic, zoom-independent shape of a single PDF page.
 *
 * Everything here is in PDF points and describes the document itself, not how
 * it is currently displayed. Two things depend on it: bounds checking when a
 * pin is placed, and knowing the page's own `/Rotate` so a user-applied
 * rotation can be added to it rather than replacing it.
 */
export class PageGeometry {
  /**
   * @param {number} width  Page width in PDF points, before rotation.
   * @param {number} height Page height in PDF points, before rotation.
   * @param {number} [rotation] The page's own `/Rotate` value. NOT the user's.
   */
  constructor(width, height, rotation = Rotation.NONE) {
    if (!(width > 0) || !(height > 0)) {
      throw new RangeError(`PageGeometry requires positive dimensions, received ${width}x${height}.`);
    }
    if (!isValidRotation(rotation)) {
      throw new RangeError(`PageGeometry rotation must be 0, 90, 180 or 270, received ${rotation}.`);
    }

    this.width = width;
    this.height = height;
    this.rotation = rotation;
    Object.freeze(this);
  }

  /**
   * True when the point falls inside the page box.
   * @param {PdfPoint} point
   * @returns {boolean}
   */
  contains(point) {
    assertInstanceOf(point, PdfPoint, 'point', COORDINATE_SPACE_HINT);
    return point.x >= 0 && point.x <= this.width && point.y >= 0 && point.y <= this.height;
  }

  /**
   * Clamps a point to the page box.
   *
   * Used when an imprecise touch lands a pixel or two past the page edge.
   * Dropping the annotation instead would read to the user as a tap that
   * silently did nothing, which is worse than a pin one point inside the edge.
   *
   * @param {PdfPoint} point
   * @returns {PdfPoint}
   */
  clamp(point) {
    assertInstanceOf(point, PdfPoint, 'point', COORDINATE_SPACE_HINT);
    return new PdfPoint(
      Math.min(Math.max(point.x, 0), this.width),
      Math.min(Math.max(point.y, 0), this.height),
    );
  }

  toString() {
    return `PageGeometry(${this.width}x${this.height}pts, rotate ${this.rotation}deg)`;
  }
}
