import { PhotoMarkup } from '../annotations/PhotoMarkup';
import { AnnotationTool } from './AnnotationTool';

/**
 * Places a photograph on the drawing with a single tap.
 *
 * ===========================================================================
 * THE TOOL DECLARES WHAT IT NEEDS; IT DOES NOT GO AND GET IT
 * ===========================================================================
 * Exactly the arrangement TextTool already uses for its string. Capturing a
 * photograph needs a camera permission prompt, a live video preview, a file
 * picker and a downscaling pass — none of which belongs in the domain tier, and
 * all of which would make this class untestable outside a browser.
 *
 * So the tool says `requiresPhoto()`, describes how to ask, and receives the
 * result as an already-stored `MediaRef`. Replacing the capture dialog with an
 * in-place camera on the sheet changes one component and nothing here.
 *
 * ---------------------------------------------------------------------------
 * WHY INSTANT
 * ---------------------------------------------------------------------------
 * A photo has no drag phase — the user taps where it should sit. Instant also
 * means a tablet tap's inevitable pixel of movement never turns the placement
 * into a discarded degenerate gesture, the same reason PinTool is instant.
 */
export class PhotoTool extends AnnotationTool {
  getId() {
    return 'photo';
  }

  getLabel() {
    return 'Photo';
  }

  isInstant() {
    return true;
  }

  requiresPhoto() {
    return true;
  }

  /**
   * Wording for the capture dialog. Supplied by the tool for the same reason
   * `getTextPrompt` is: only the tool knows what it is asking for, and a
   * conditional in the presentation layer would have to be edited by every
   * future tool that wants a photograph.
   */
  getPhotoPrompt() {
    return {
      title: 'Add a photo',
      hint: 'Take one now, or choose a file. It will be placed where you tapped.',
      confirmLabel: 'Place photo',
    };
  }

  /**
   * @param {import('./AnnotationTool').DraftRequest & { photo: import('../media/MediaRef').MediaRef }} request
   * @returns {PhotoMarkup}
   */
  createDraft({ id, sheetId, point, photo }) {
    return new PhotoMarkup(
      id,
      sheetId,
      point,
      photo,
      '',
      PhotoMarkup.defaultWidthFor(photo),
      new Date(),
    );
  }

  /** No drag phase; the draft is already final. */
  extendDraft(draft) {
    return draft;
  }

  /**
   * Never discarded. A photo has no size the user chose, so it cannot be
   * degenerate — and discarding one would throw away bytes already committed
   * to the media store.
   */
  finalize(draft) {
    return draft;
  }
}
