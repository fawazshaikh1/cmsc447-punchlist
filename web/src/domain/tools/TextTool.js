import { TextMarkup } from '../annotations/TextMarkup';
import { AnnotationTool } from './AnnotationTool';

/**
 * Places a text callout at a tapped location.
 *
 * Instant like PinTool, but additionally declares `requiresText()`, which tells
 * the presentation layer to collect the string before the draft is created.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TOOL DOES NOT COLLECT THE TEXT ITSELF
 * ---------------------------------------------------------------------------
 * Prompting the user is a presentation concern — it needs a dialog, a focused
 * input, a keyboard on a tablet, and cancellation. None of that belongs in the
 * domain tier, and putting it here would make this class untestable outside a
 * browser.
 *
 * So the tool declares the REQUIREMENT and the presentation layer satisfies it,
 * passing the result in as `request.text`. Swapping today's placeholder prompt
 * for a proper inline editor changes one file in the presentation tier and
 * nothing here.
 */
export class TextTool extends AnnotationTool {
  getId() {
    return 'text';
  }

  getLabel() {
    return 'Text';
  }

  isInstant() {
    return true;
  }

  requiresText() {
    return true;
  }

  /** A callout is a short label on a drawing, so one line is right. */
  getTextPrompt() {
    return {
      title: 'Add a callout',
      label: 'Callout text',
      placeholder: 'e.g. SEE DETAIL 3/A-401',
      confirmLabel: 'Add callout',
      multiline: false,
    };
  }

  /** @param {import('./AnnotationTool').DraftRequest} request @returns {TextMarkup} */
  createDraft({ id, sheetId, point, style, text }) {
    return new TextMarkup(
      id,
      sheetId,
      point,
      text,
      TextMarkup.DEFAULT_FONT_SIZE,
      style,
      new Date(),
    );
  }

  extendDraft(draft) {
    return draft;
  }

  /** Text is never degenerate — TextMarkup already rejects empty strings. */
  finalize(draft) {
    return draft;
  }
}
