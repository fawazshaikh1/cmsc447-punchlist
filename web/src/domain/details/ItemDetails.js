import { ItemFieldRegistry } from './ItemFieldRegistry';

/**
 * The extra information recorded on one punch item: its trade, who is
 * responsible, when it is due — whatever fields are registered. Immutable.
 *
 * ===========================================================================
 * WHY THIS IS ONE VALUE RATHER THAN FOUR PROPERTIES
 * ===========================================================================
 * `Pin` carries a single `details` and passes it through every copy it makes.
 * That is the whole of what Pin knows about fields, so adding a fifth field
 * touches nothing in Pin — the alternative was a constructor that grew by one
 * argument per field, with every `with*` method having to remember them all.
 *
 * Stored as a flat object of strings under the pin's `payload.details`, e.g.
 *
 *     { trade: 'Electrical', responsibleCompany: 'Rivera Electric',
 *       dueDate: '2026-10-10' }
 *
 * Unset fields are absent rather than '', so a pin nobody has assigned stores
 * exactly what it stored before this feature existed.
 *
 * ---------------------------------------------------------------------------
 * VALUES THIS BUILD DOES NOT UNDERSTAND ARE KEPT, NOT DELETED
 * ---------------------------------------------------------------------------
 * When Sprint 3 adds a field, a teammate on an older checkout — or a tablet
 * that has not reloaded — will read pins carrying it. Dropping unknown keys on
 * read would mean that the first time the older client saved any edit to that
 * pin, the newer field's value would be erased for everybody. So unknown keys
 * are carried through every copy and every save untouched, and only known keys
 * are cleaned.
 */
export class ItemDetails {
  /** @type {ItemDetails} */
  static EMPTY;

  /** @type {Readonly<Record<string, string|number|boolean>>} */
  #values;

  /**
   * Prefer `ItemDetails.fromJSON` or `ItemDetails.EMPTY.with(...)`; the
   * constructor trusts its input and is meant for this class's own use.
   *
   * @param {Record<string, string|number|boolean>} values Already cleaned.
   */
  constructor(values = {}) {
    this.#values = Object.freeze({ ...values });
    Object.freeze(this);
  }

  /**
   * Rebuilds details from storage. Lenient, like every `fromJSON` in the
   * domain: anything that is not a plain object is treated as "no details",
   * known fields are normalized and dropped if unusable, and unknown fields
   * are kept if they are plain values.
   *
   * @param {unknown} raw
   * @returns {ItemDetails}
   */
  static fromJSON(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ItemDetails.EMPTY;

    const values = {};
    for (const [key, value] of Object.entries(raw)) {
      const field = ItemFieldRegistry.get(key);

      if (field) {
        const normalized = field.normalize(value);
        if (normalized) values[key] = normalized;
      } else if (isPlainValue(value)) {
        values[key] = value;
      }
    }

    return Object.keys(values).length === 0 ? ItemDetails.EMPTY : new ItemDetails(values);
  }

  /**
   * The stored value of a field, or '' when it is not set.
   *
   * @param {string} key
   * @returns {string}
   */
  get(key) {
    const value = this.#values[key];
    return value === undefined ? '' : String(value);
  }

  /**
   * Returns a copy with one field changed. Returns THIS SAME INSTANCE when the
   * cleaned value is what is already stored, so a caller can tell a real edit
   * from someone tabbing through a field — and avoid recording an undo step
   * and a change-log entry for nothing.
   *
   * Strict, unlike `fromJSON`: an unregistered key or a value the field
   * rejects throws. The editor validates first, so reaching a throw here means
   * something bypassed it — the moment to fail loudly rather than store junk
   * or, worse, quietly clear the field.
   *
   * @param {string} key A registered field key.
   * @param {unknown} raw The value as entered.
   * @returns {ItemDetails}
   */
  with(key, raw) {
    const field = ItemFieldRegistry.get(key);
    if (!field) {
      throw new RangeError(`No item field is registered under "${key}".`);
    }

    const problem = field.validate(raw);
    if (problem) throw new RangeError(`${field.getLabel()}: ${problem}`);

    const next = field.normalize(raw);
    if (next === this.get(key)) return this;

    const values = { ...this.#values };
    if (next) values[key] = next;
    else delete values[key];

    return Object.keys(values).length === 0 ? ItemDetails.EMPTY : new ItemDetails(values);
  }

  /** @returns {boolean} */
  isEmpty() {
    return Object.keys(this.#values).length === 0;
  }

  /** @param {ItemDetails} other */
  equals(other) {
    if (!(other instanceof ItemDetails)) return false;

    const mine = Object.keys(this.#values);
    const theirs = other.toJSON();
    return (
      mine.length === Object.keys(theirs).length &&
      mine.every((key) => this.#values[key] === theirs[key])
    );
  }

  /** @returns {Record<string, string|number|boolean>} A plain copy, safe to mutate. */
  toJSON() {
    return { ...this.#values };
  }
}

ItemDetails.EMPTY = new ItemDetails();

/** Primitives only: an unknown nested object is not something we can vouch for. */
function isPlainValue(value) {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
