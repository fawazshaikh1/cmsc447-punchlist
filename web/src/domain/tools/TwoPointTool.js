import { enforceContract, abstractMethod } from '../support/contracts';
import { AnnotationTool } from './AnnotationTool';

/**
 * Abstract tool for any markup created by pressing, dragging and releasing.
 *
 * Implements the entire drag interaction once. A concrete tool supplies only
 * its identity and which markup class to build:
 *
 *     export class RectangleTool extends TwoPointTool {
 *       getId()    { return 'rectangle'; }
 *       getLabel() { return 'Rectangle'; }
 *       createMarkup(...args) { return new RectangleMarkup(...args); }
 *     }
 *
 * Three tools in Sprint 2 share this — rectangle, cloud, arrow — and any future
 * two-point markup (ellipse, dimension line, measurement) is another handful of
 * lines. That is the payoff for putting the gesture in a base class rather than
 * in each tool.
 *
 * IMPLEMENTATION NOTE: `extendDraft` rebuilds the markup from
 * `draft.start` and the new point, rather than mutating the draft. The domain
 * objects are frozen, and rebuilding means the live preview is a genuine,
 * fully-validated annotation at every frame — so the preview cannot diverge
 * from what will actually be saved.
 */
export class TwoPointTool extends AnnotationTool {
  static REQUIRED = ['getId', 'getLabel', 'createMarkup'];

  constructor() {
    super();
    enforceContract(this, new.target, TwoPointTool);
  }

  /**
   * Builds the concrete markup. The one thing subclasses must supply.
   *
   * @param {string} id
   * @param {string} sheetId
   * @param {import('../geometry/PdfPoint').PdfPoint} start
   * @param {import('../geometry/PdfPoint').PdfPoint} end
   * @param {import('../annotations/MarkupStyle').MarkupStyle} style
   * @param {Date} createdAt
   * @returns {import('../annotations/TwoPointMarkup').TwoPointMarkup}
   */
  createMarkup(id, sheetId, start, end, style, createdAt) {
    return abstractMethod('TwoPointTool', 'createMarkup', id, sheetId, start, end, style, createdAt);
  }

  /** @param {import('./AnnotationTool').DraftRequest} request */
  createDraft({ id, sheetId, point, style }) {
    // Start and end are the same point until the pointer moves, which renders
    // as a zero-size shape — correct, and discarded by `finalize` if the user
    // releases without dragging.
    return this.createMarkup(id, sheetId, point, point, style, new Date());
  }

  extendDraft(draft, point) {
    return this.createMarkup(
      draft.id,
      draft.sheetId,
      draft.start,
      point,
      draft.style,
      draft.createdAt,
    );
  }
}
