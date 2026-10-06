/**
 * @typedef {object} FieldEditorProps
 * @property {import('../../../domain/details').ItemField} field
 * @property {string} value The stored, normalized value; '' when unset.
 * @property {boolean} readOnly True when the item is issued (or, once roles
 *           are on, when the user may not change it).
 * @property {string[]} suggestions Values to offer while typing.
 * @property {string} identity Changes when the editor starts showing a
 *           different item — the annotation id. Pass it to useCommitOnBlur.
 * @property {(raw: string) => void} onCommit Saves a value. Call it at most
 *           once per edit, and only with a value `field.validate` accepts.
 */

/**
 * Maps an item field's INPUT KIND to the component that edits it.
 *
 * The presentation half of ItemFieldRegistry. The domain says a due date is a
 * 'date' and a trade is 'text'; this decides what a 'date' looks like on
 * screen. Keeping the two apart is what lets a field be added without touching
 * React, and an input be restyled without touching the domain.
 *
 * When accounts exist, "pick a company from the project's list" is a new kind:
 * one editor file registered here and one field file in the domain. The panel
 * does not change.
 *
 * A kind with no editor is not an error — ItemDetailsEditor falls back to a
 * read-only display, so the value is still seen rather than silently missing.
 */
export class FieldEditorRegistry {
  /** @type {Map<string, import('react').ComponentType<FieldEditorProps>>} */
  static #editors = new Map();

  constructor() {
    throw new TypeError('FieldEditorRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {string} inputKind
   * @param {import('react').ComponentType<FieldEditorProps>} Component
   */
  static register(inputKind, Component) {
    if (typeof Component !== 'function') {
      throw new TypeError(`The editor registered for "${inputKind}" must be a component.`);
    }

    if (this.#editors.has(inputKind)) {
      // Same dev/production split as every registry: a duplicate in
      // development is Vite re-running this module on save.
      if (!import.meta.env?.DEV) {
        throw new Error(`An editor is already registered for input kind "${inputKind}".`);
      }
      console.warn(`[FieldEditorRegistry] Re-registering "${inputKind}". Expected during hot reload.`);
    }

    this.#editors.set(inputKind, Component);
  }

  /** @param {string} inputKind */
  static get(inputKind) {
    return this.#editors.get(inputKind);
  }
}
