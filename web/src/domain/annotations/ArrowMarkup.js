import { TwoPointMarkup } from './TwoPointMarkup';
import { AnnotationRegistry } from './AnnotationRegistry';

export const ARROW_KIND = 'arrow';

/** Arrowhead length in PDF points, so it scales with the drawing. */
const HEAD_LENGTH = 14;
const HEAD_HALF_ANGLE_RAD = Math.PI / 7;

/**
 * A directional arrow pointing at a detail.
 *
 * ---------------------------------------------------------------------------
 * THE ONE WAY THIS DIFFERS FROM ITS SIBLINGS
 * ---------------------------------------------------------------------------
 * Rectangle and Cloud treat `start` and `end` as interchangeable corners — drag
 * either direction, same result. An arrow does NOT: `start` is the tail and
 * `end` is the head, and swapping them reverses the meaning entirely.
 *
 * This is why TwoPointMarkup keeps `start`/`end` unnormalised and only
 * NORMALISES inside `getBounds()`. Had the base class normalised on
 * construction — which is tempting, since two of the three subclasses want it —
 * arrows would silently point the wrong way roughly half the time, depending on
 * which direction the user happened to drag.
 *
 * A good reminder that "share what is common" has to stop exactly where the
 * semantics diverge.
 */
export class ArrowMarkup extends TwoPointMarkup {
  getKind() {
    return ARROW_KIND;
  }

  /** @returns {number} Length of the arrowhead in PDF points. */
  getHeadLength() {
    return HEAD_LENGTH;
  }

  /**
   * The two barb endpoints of the arrowhead, in PDF user space.
   *
   * Computed here rather than in the renderer because both the SVG marker and
   * the PDF exporter need the identical geometry — if they each did their own
   * trigonometry, the on-screen arrow and the exported arrow would eventually
   * disagree, and that discrepancy would only be noticed by a user opening the
   * export in Acrobat.
   *
   * @returns {{ left: { x: number, y: number }, right: { x: number, y: number } }}
   */
  getHeadBarbs() {
    // Angle of the shaft, measured from the head back toward the tail.
    const angle = Math.atan2(this.start.y - this.end.y, this.start.x - this.end.x);

    return {
      left: {
        x: this.end.x + HEAD_LENGTH * Math.cos(angle - HEAD_HALF_ANGLE_RAD),
        y: this.end.y + HEAD_LENGTH * Math.sin(angle - HEAD_HALF_ANGLE_RAD),
      },
      right: {
        x: this.end.x + HEAD_LENGTH * Math.cos(angle + HEAD_HALF_ANGLE_RAD),
        y: this.end.y + HEAD_LENGTH * Math.sin(angle + HEAD_HALF_ANGLE_RAD),
      },
    };
  }

  /**
   * An arrow is degenerate when it is too SHORT, not when its bounding box is
   * small — a perfectly good vertical arrow has zero width. Overriding the
   * base implementation, which measures the box.
   *
   * @param {number} [minimumPts]
   * @returns {boolean}
   */
  isDegenerate(minimumPts = 6) {
    return Math.hypot(this.end.x - this.start.x, this.end.y - this.start.y) < minimumPts;
  }

  /** @param {object} dto @returns {ArrowMarkup} */
  static fromJSON(dto) {
    return new ArrowMarkup(...TwoPointMarkup.argsFromJSON(dto));
  }
}

AnnotationRegistry.register(ARROW_KIND, ArrowMarkup.fromJSON);
