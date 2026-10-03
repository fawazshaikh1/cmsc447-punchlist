import { ItemField } from './ItemField';

/**
 * A short line of free text — a trade, a company, a person's name.
 *
 * The base for every text field, so the rules for what a "clean" value is are
 * written once. Those rules matter more than they look: these values are what
 * the task list filters on and what the CSV export groups by, so "Rivera
 * Electric", " Rivera  Electric" and "Rivera Electric" followed by a
 * non-breaking space must all be the same company, or a subcontractor's
 * filter quietly misses a third of their items.
 *
 * Abstract in practice: a concrete field still supplies its key and label,
 * and `enforceContract` refuses one that does not.
 */
export class TextItemField extends ItemField {
  /**
   * Long enough for "Mid-Atlantic Mechanical & Fire Protection, Inc.", short
   * enough to fit a schedule column. A field may raise or lower it.
   */
  static MAX_LENGTH = 80;

  getInputKind() {
    return 'text';
  }

  getMaxLength() {
    return TextItemField.MAX_LENGTH;
  }

  /**
   * Trims, collapses every run of whitespace — including the non-breaking
   * space an iPad's autocorrect leaves behind, tabs and pasted line breaks — to
   * one ordinary space, drops control characters and the zero-width characters
   * that ride along when text is pasted from a web page or a PDF, and caps the
   * length.
   *
   * The cap counts characters, not UTF-16 units, so it can never cut an emoji
   * or an accented letter built from two code points in half and store a
   * broken character.
   *
   * @param {unknown} raw
   * @returns {string}
   */
  normalize(raw) {
    if (typeof raw !== 'string') return '';

    const cleaned = raw
      // eslint-disable-next-line no-control-regex -- removing them is the point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const limit = this.getMaxLength();
    if (!limit) return cleaned;

    return Array.from(cleaned).slice(0, limit).join('').trim();
  }
}
