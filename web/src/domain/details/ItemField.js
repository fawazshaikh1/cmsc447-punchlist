import { abstractMethod, enforceContract } from '../support/contracts';

/**
 * One piece of information recorded on a punch item — its trade, who is
 * responsible, when it is due. CONTRACT.
 *
 * ===========================================================================
 * WHY A FIELD IS A CLASS IN ITS OWN FILE
 * ===========================================================================
 * Trade, responsible company, assignee and due date arrived together, and the
 * list will not stop there: priority, room, cost to fix, a reference to the
 * spec section. Written as properties on `Pin`, each one would mean editing
 * the constructor, every `with*` copy method, `serializePayload`, `fromJSON`,
 * the properties panel, and every verify script that builds a pin — and the
 * copy method that forgot one would silently drop it on the next edit.
 *
 * Instead a field describes itself and registers with `ItemFieldRegistry`:
 *
 *   key           where it is stored. Never renamed once shipped.
 *   label         what the user sees.
 *   input kind    which editor draws it ('text', 'date'). The presentation tier
 *                 maps kinds to components, so a new KIND of input is also a
 *                 new file rather than an edit.
 *   normalize     turns anything — a keystroke, a stored value, a value from a
 *                 newer build — into the canonical stored form.
 *   validate      says, in words, why a user's input cannot be accepted.
 *
 * Adding a field is one new file and one registration line in this folder's
 * `index.js`. `Pin`, the panel, storage and the change log all pick it up.
 *
 * Values are strings throughout, with '' meaning "not set". One type keeps the
 * stored shape flat — it maps straight onto a JSONB column and the Go API's
 * `map[string]string` — and leaves the meaning of the string to the field.
 */
export class ItemField {
  /** Methods a concrete field must provide. @see enforceContract */
  static REQUIRED = ['getKey', 'getLabel', 'getInputKind', 'normalize'];

  constructor() {
    enforceContract(this, new.target, ItemField);
  }

  /**
   * Storage key, camelCase. It is a column name in all but name: once data has
   * been saved under it, renaming it orphans every stored value.
   * @returns {string}
   */
  getKey() {
    return abstractMethod('ItemField', 'getKey');
  }

  /** @returns {string} Shown beside the input, e.g. 'Trade'. */
  getLabel() {
    return abstractMethod('ItemField', 'getLabel');
  }

  /** @returns {string} Which editor the presentation tier should use. */
  getInputKind() {
    return abstractMethod('ItemField', 'getInputKind');
  }

  /**
   * The canonical stored form of a value, or '' when it is empty or unusable.
   *
   * MUST NOT THROW. It runs on every value read from storage, and one odd
   * value is not a reason to fail loading a sheet. It must also be idempotent —
   * normalizing a normalized value changes nothing — because stored values are
   * normalized again each time they are read.
   *
   * @param {unknown} raw
   * @returns {string}
   */
  normalize(raw) {
    return abstractMethod('ItemField', 'normalize', raw);
  }

  /**
   * Why the user's input cannot be saved, or null if it can.
   *
   * Separate from `normalize` on purpose. Reading storage is lenient: a bad
   * value is dropped and the sheet loads. A USER typing a bad value must be
   * told, not have the field quietly emptied — so the editor asks this first
   * and keeps what they typed on screen next to the message.
   *
   * @param {unknown} raw
   * @returns {string|null}
   */
  validate(raw) {
    void raw;
    return null;
  }

  /**
   * How a stored value reads in a list, a report or an export. Defaults to the
   * value itself; a date overrides it.
   *
   * @param {string} value A normalized value.
   * @returns {string}
   */
  format(value) {
    return value;
  }

  /** @returns {string} Hint text for an empty input. */
  getPlaceholder() {
    return '';
  }

  /**
   * Values to offer while typing. Suggestions only — anything else may still
   * be entered, because no fixed list survives contact with a real job site.
   *
   * @returns {string[]}
   */
  getSuggestions() {
    return [];
  }

  /** @returns {number|undefined} Longest value accepted, in characters. */
  getMaxLength() {
    return undefined;
  }

  /**
   * The words for the undo button and the change log: "Set trade of" reads as
   * "Undo: Set trade of pin" and "this device edited it".
   *
   * @param {string} value The normalized value being saved.
   * @returns {string}
   */
  describeChange(value) {
    const name = this.getLabel().toLowerCase();
    return value ? `Set ${name} of` : `Clear ${name} of`;
  }
}
