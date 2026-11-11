/**
 * @typedef {object} TaskGrouping
 * @property {string} key
 * @property {string} label As the Group menu shows it.
 * @property {(row: import('./taskRows').TaskRow) => { key: string, label: string }} groupOf
 *           Which group a row belongs to.
 * @property {(a: import('./taskRows').TaskRow, b: import('./taskRows').TaskRow) => number} order
 *           Orders the groups, by comparing their first rows.
 */

/**
 * The ways the Tasks tab can group (spec 6.2) — by sheet, status, priority,
 * company, or not at all. A registry for the same reason as TaskSortRegistry.
 */
export class TaskGroupRegistry {
  /** @type {Map<string, TaskGrouping>} */
  static #groupings = new Map();

  constructor() {
    throw new TypeError('TaskGroupRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {string} key
   * @param {{ label: string, groupOf: TaskGrouping['groupOf'], order: TaskGrouping['order'] }} grouping
   */
  static register(key, { label, groupOf, order }) {
    if (typeof groupOf !== 'function' || typeof order !== 'function') {
      throw new TypeError(`The grouping "${key}" needs groupOf and order functions.`);
    }
    if (this.#groupings.has(key) && !import.meta.env?.DEV) {
      throw new Error(`A task grouping is already registered as "${key}".`);
    }
    this.#groupings.set(key, Object.freeze({ key, label, groupOf, order }));
  }

  /** @param {string} key @returns {TaskGrouping|undefined} */
  static get(key) {
    return this.#groupings.get(key);
  }

  /** @returns {TaskGrouping[]} In the order they were registered. */
  static all() {
    return [...this.#groupings.values()];
  }
}
