import { TwoPointMarkup } from './TwoPointMarkup';
import { AnnotationRegistry } from './AnnotationRegistry';

export const CLOUD_KIND = 'cloud';

/** Radius of each scallop arc, in PDF points. */
/**
 * Roughly how many bumps go around the whole cloud, whatever its size.
 *
 * A FIXED radius was the first attempt and it looked wrong at both ends: a
 * small cloud came out as three enormous lobes, and a large one as a tight coil
 * of dozens of tiny curls that read as a spring rather than a cloud. Draughting
 * convention is a roughly constant NUMBER of bumps, so they grow with the shape.
 */
const TARGET_BUMPS = 18;

/** Bounds in PDF points, so a tiny cloud still reads and a huge one is not coarse. */
const MIN_ARC_RADIUS = 7;
const MAX_ARC_RADIUS = 34;

/**
 * A revision cloud — a rectangle whose border is drawn as a chain of scalloped
 * arcs.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TYPE MATTERS MORE THAN IT LOOKS
 * ---------------------------------------------------------------------------
 * The revision cloud is THE convention in architectural and engineering
 * practice for "this region changed" or "this region has an issue". An
 * architect reviewing a marked-up sheet looks for clouds first. Shipping it
 * signals that the tool was built by people who understood the domain rather
 * than people who wrapped a generic drawing library — and it is exactly the
 * kind of detail a stakeholder notices in a demo.
 *
 * It also exports beautifully: the PDF specification has a native border effect
 * for this (`/BE << /S /C /I n >>` — Style Cloudy, Intensity n) applied to a
 * `/Polygon` annotation. So the exported cloud is not an approximation drawn
 * with our own arcs; it is a real cloudy-bordered PDF annotation that Acrobat
 * renders with its own scallops and lets the user select and edit.
 */
export class CloudMarkup extends TwoPointMarkup {
  getKind() {
    return CLOUD_KIND;
  }

  /**
   * Nominal radius of the bumps, in PDF points, scaled to this cloud.
   *
   * Derived from the perimeter so the bump COUNT stays roughly constant as the
   * user drags: a cloud around a door detail and one around half a floor plan
   * both get about eighteen bumps, which is what makes them read as the same
   * symbol at different sizes.
   *
   * Clamped at both ends, and the perimeter is guarded against zero — a cloud
   * is zero-sized on pointerdown, before the drag has moved, and dividing by
   * that is exactly the arithmetic that once produced NaN coordinates and a
   * white screen. See scallopArcs for the full account.
   *
   * Exposed as a method rather than a constructor parameter because it is a
   * rendering characteristic rather than user data. When "cloud density"
   * becomes a user preference, this becomes a payload field, and only this file
   * changes.
   *
   * @returns {number}
   */
  getArcRadius() {
    const { width, height } = this.getBounds();
    const perimeter = 2 * (width + height);

    if (!(perimeter > 0)) return MIN_ARC_RADIUS;

    // Each bump spans a diameter of the perimeter, hence the factor of two.
    const ideal = perimeter / (TARGET_BUMPS * 2);

    return Math.min(MAX_ARC_RADIUS, Math.max(MIN_ARC_RADIUS, ideal));
  }

  /** @param {object} dto @returns {CloudMarkup} */
  static fromJSON(dto) {
    return new CloudMarkup(...TwoPointMarkup.argsFromJSON(dto));
  }
}

AnnotationRegistry.register(CLOUD_KIND, CloudMarkup.fromJSON);
