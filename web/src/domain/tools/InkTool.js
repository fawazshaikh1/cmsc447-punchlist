import { InkMarkup } from '../annotations/InkMarkup';
import { AnnotationTool } from './AnnotationTool';

/**
 * Minimum distance between consecutive sampled points, in PDF points.
 *
 * A pointer fires far more move events than a stroke needs — a two-second
 * finger drag can produce several hundred. Storing all of them bloats the row,
 * the API payload and the exported `/InkList` for no visible benefit, since
 * points a fraction of a point apart are indistinguishable once drawn.
 *
 * This is deliberately a DISTANCE filter rather than a time or count filter:
 * it keeps detail where the stroke curves quickly and discards it on long
 * straight runs, which is exactly the right trade for freehand marking.
 */
const MIN_SAMPLE_DISTANCE_PTS = 1.5;

/**
 * Freehand drawing — the tool a finger or stylus uses on a tablet.
 *
 * Unlike the shape tools, this ACCUMULATES points rather than tracking a single
 * moving endpoint, which is why it extends AnnotationTool directly instead of
 * TwoPointTool. Trying to force it into that hierarchy would mean a base class
 * whose "two points" meant nothing for one of its subclasses.
 */
export class InkTool extends AnnotationTool {
  getId() {
    return 'ink';
  }

  getLabel() {
    return 'Draw';
  }

  /** @param {import('./AnnotationTool').DraftRequest} request @returns {InkMarkup} */
  createDraft({ id, sheetId, point, style }) {
    return new InkMarkup(id, sheetId, [point], style, new Date());
  }

  /**
   * Appends a sampled point, skipping ones too close to the previous.
   *
   * @param {InkMarkup} draft
   * @param {import('../geometry/PdfPoint').PdfPoint} point
   * @returns {InkMarkup}
   */
  extendDraft(draft, point) {
    const last = draft.points[draft.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_SAMPLE_DISTANCE_PTS) {
      // Returning the SAME instance matters: React re-renders on reference
      // change, so handing back an identical-but-new object would repaint the
      // overlay on every discarded sample and make drawing feel sluggish.
      return draft;
    }

    return new InkMarkup(
      draft.id,
      draft.sheetId,
      [...draft.points, point],
      draft.style,
      draft.createdAt,
    );
  }
}
