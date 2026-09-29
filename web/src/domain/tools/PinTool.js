import { Pin, PinStatus } from '../annotations/Pin';
import { AnnotationTool } from './AnnotationTool';

/**
 * Places a punch-item pin with a single tap.
 *
 * `isInstant()` is true, which matters more on a tablet than it looks: a real
 * finger tap always carries a pixel or two of movement, so treating it as a
 * drag would route every pin through the degenerate-gesture check and discard
 * about half of them.
 *
 * ===========================================================================
 * THE DESCRIPTION IS COLLECTED BEFORE THE PIN EXISTS
 * ===========================================================================
 * `requiresText()` is true, so the presentation layer asks for the description
 * first and the pin is constructed with it already in place. The pin is never
 * stored blank, not even for a moment.
 *
 * The alternative — create it on tap, describe it afterwards in the panel — is
 * what produced the problem this solves. Placing a pin takes a second, writing
 * the description takes ten, and on a walk-through the second one loses. The
 * result is a set of numbered markers on an issued drawing with nothing
 * attached to them, and nobody able to reconstruct what they meant.
 *
 * Collecting it up front costs the same ten seconds, but spends them while the
 * user is still standing in front of the defect.
 *
 * `RequiredDescriptionRule` enforces the same thing at the write path, so this
 * is the convenient route to a complete pin rather than the only one holding
 * the line. A pin created by some future code path that skips the tool is still
 * refused by `EditorService`.
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

  requiresText() {
    return true;
  }

  /**
   * Worded as the question a superintendent is already answering in their head
   * when they stop walking. "Description" would be a form field; this is a
   * prompt.
   */
  getTextPrompt() {
    return {
      title: 'What needs fixing?',
      label: 'Description',
      placeholder: 'e.g. Grout missing along east wall tile',
      confirmLabel: 'Add pin',
      // Multiline: defects are frequently two sentences, and a single-line
      // input on an iPad makes people truncate rather than scroll.
      multiline: true,
    };
  }

  /** @param {import('./AnnotationTool').DraftRequest} request @returns {Pin} */
  createDraft({ id, sheetId, point, text }) {
    return new Pin(id, sheetId, point, text ?? '', PinStatus.OPEN, new Date());
  }

  /** A pin has no drag phase; the draft is already final. */
  extendDraft(draft) {
    return draft;
  }

  /**
   * Never discarded for being degenerate — a pin has no size, so a tap anywhere
   * is a valid placement. Completeness is a separate question, answered by
   * `RequiredDescriptionRule` at the write path.
   */
  finalize(draft) {
    return draft;
  }
}
