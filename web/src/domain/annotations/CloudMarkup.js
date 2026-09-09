import { TwoPointMarkup } from './TwoPointMarkup';
import { AnnotationRegistry } from './AnnotationRegistry';

export const CLOUD_KIND = 'cloud';

/** Radius of each scallop arc, in PDF points. */
const DEFAULT_ARC_RADIUS = 9;

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
   * Radius of the scallop arcs, in PDF points.
   *
   * Exposed as a method rather than a constructor parameter because it is a
   * rendering characteristic rather than user data — nothing in the UI sets it
   * per-cloud today. When "cloud density" becomes a user preference, this
   * becomes a payload field, and only this file and the two renderers change.
   *
   * @returns {number}
   */
  getArcRadius() {
    return DEFAULT_ARC_RADIUS;
  }

  /** @param {object} dto @returns {CloudMarkup} */
  static fromJSON(dto) {
    return new CloudMarkup(...TwoPointMarkup.argsFromJSON(dto));
  }
}

AnnotationRegistry.register(CLOUD_KIND, CloudMarkup.fromJSON);
