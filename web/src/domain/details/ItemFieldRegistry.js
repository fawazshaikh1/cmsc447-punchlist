import { assertInstanceOf } from '../support/contracts';
import { ItemField } from './ItemField';

/**
 * Every field a punch item can carry, in the order they are shown.
 *
 * ===========================================================================
 * THE SEVENTH REGISTRY
 * ===========================================================================
 *   AnnotationRegistry      how to REBUILD it from storage
 *   MarkerRegistry          how to DRAW it on screen
 *   ToolRegistry            how to CREATE it from a gesture
 *   PdfWriterRegistry       how to WRITE it into an exported PDF
 *   AnnotationRuleRegistry  when it is COMPLETE enough to issue
 *   PunchListRegistry       how it reads on the SCHEDULE
 *   ItemFieldRegistry       what ELSE is recorded about it        <- this one
 *
 * The panel, `ItemDetails` and the verify suite read the field list from here,
 * so none of them names a field. Order is registration order, which is why the
 * registrations live together in `index.js` rather than at the bottom of each
 * field's file — the same reason `ToolRegistry` is filled in palette order.
 *
 * An unknown key is not an error anywhere this registry is consulted. A value
 * saved by a newer build, under a field this build has never heard of, is
 * carried through untouched rather than deleted — see ItemDetails.
 */
export class ItemFieldRegistry {
  /** @type {Map<string, ItemField>} */
  static #fields = new Map();

  static #KEY = /^[a-z][A-Za-z0-9]*$/;

  constructor() {
    throw new TypeError('ItemFieldRegistry is static and cannot be instantiated.');
  }

  /** @param {ItemField} field */
  static register(field) {
    assertInstanceOf(field, ItemField, 'item field');

    const key = field.getKey();
    if (typeof key !== 'string' || !ItemFieldRegistry.#KEY.test(key)) {
      throw new TypeError(
        `${field.constructor.name}.getKey() must return a camelCase identifier, received ${JSON.stringify(key)}.`,
      );
    }

    if (this.#fields.has(key)) {
      // The same dev/production split every registry uses: Vite re-executes a
      // module on save, so a duplicate during development is a hot reload, not
      // a mistake. In a production bundle each module runs once, and a
      // duplicate means two fields claiming one storage key — a real bug.
      // Re-setting an existing Map key keeps its original position, so a hot
      // reload never reorders the panel.
      if (!import.meta.env?.DEV) {
        throw new Error(`An item field is already registered under "${key}".`);
      }
      console.warn(`[ItemFieldRegistry] Re-registering "${key}". Expected during hot reload.`);
    }

    this.#fields.set(key, field);
  }

  /** @param {string} key @returns {ItemField|undefined} */
  static get(key) {
    return this.#fields.get(key);
  }

  /** @param {string} key @returns {boolean} */
  static has(key) {
    return this.#fields.has(key);
  }

  /** @returns {ItemField[]} In display order. */
  static all() {
    return [...this.#fields.values()];
  }
}
