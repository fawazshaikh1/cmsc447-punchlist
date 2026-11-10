/**
 * @typedef {object} TaskSort
 * @property {string} key
 * @property {string} label As the Sort menu shows it.
 * @property {(a: import('./taskRows').TaskRow, b: import('./taskRows').TaskRow) => number} compare
 */

/**
 * The ways the Tasks tab can sort (spec 6.2). A registry rather than a
 * `switch` in the list: a new order is a new definition and one line in
 * `domain/tasks/index.js`, and the Sort menu lists it with no edit.
 */
export class TaskSortRegistry {
  /** @type {Map<string, TaskSort>} */
  static #sorts = new Map();

  constructor() {
    throw new TypeError('TaskSortRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {string} key
   * @param {{ label: string, compare: TaskSort['compare'] }} sort
   */
  static register(key, { label, compare }) {
    if (typeof compare !== 'function') throw new TypeError(`The sort "${key}" needs a compare function.`);
    if (this.#sorts.has(key) && !import.meta.env?.DEV) {
      throw new Error(`A task sort is already registered as "${key}".`);
    }
    this.#sorts.set(key, Object.freeze({ key, label, compare }));
  }

  /** @param {string} key @returns {TaskSort|undefined} */
  static get(key) {
    return this.#sorts.get(key);
  }

  /** @returns {TaskSort[]} In the order they were registered. */
  static all() {
    return [...this.#sorts.values()];
  }
}
