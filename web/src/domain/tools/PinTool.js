import { Pin, PinStatus } from '../annotations/Pin';
import { AnnotationTool } from './AnnotationTool';

/**
 * Places a punch-item pin with a single tap. The SCRUM-19 interaction.
 *
 * `isInstant()` is true, which matters more on a tablet than it looks: a real
 * finger tap always carries a pixel or two of movement, so treating it as a
 * drag would route every pin through the degenerate-gesture check and discard
 * about half of them.
 */
export class PinTool extends AnnotationTool {
  getId() {
    return 'pin';
  }

  getLabel() {
    return 'Pin';
  }

  isInstant() {
    return true;
  }

  /** @param {import('./AnnotationTool').DraftRequest} request @returns {Pin} */
  createDraft({ id, sheetId, point }) {
    return new Pin(id, sheetId, point, '', PinStatus.OPEN, new Date());
  }

  /** A pin has no drag phase; the draft is already final. */
  extendDraft(draft) {
    return draft;
  }

  /**
   * Never discarded. Overriding the base rule because a pin has no size and so
   * can never be "degenerate" — a tap anywhere is a valid punch item.
   */
  finalize(draft) {
    return draft;
  }
}
