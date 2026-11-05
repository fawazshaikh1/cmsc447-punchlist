/**
 * Which key picks which tool.
 *
 * A registry rather than a `switch` on the key, for the reason every other
 * registry here exists: a new tool brings its own key with one registration
 * line in `presentation/tools/index.js`, and nothing that reads keys changes.
 *
 * Keys are single characters, matched without regard to case — Shift is not
 * part of a tool's shortcut, and Caps Lock left on must not disable them all.
 */
export class ToolShortcutRegistry {
  /** @type {Map<string, string>} key (upper case) -> tool id */
  static #tools = new Map();
  /** @type {Map<string, string>} tool id -> key (upper case) */
  static #keys = new Map();

  constructor() {
    throw new TypeError('ToolShortcutRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {string} toolId A ToolRegistry id, e.g. 'pin'.
   * @param {string} key One character, e.g. 'P'.
   */
  static register(toolId, key) {
    if (typeof key !== 'string' || key.length !== 1) {
      throw new TypeError(`A tool shortcut is one character; got ${JSON.stringify(key)} for "${toolId}".`);
    }
    const upper = key.toUpperCase();
    const taken = this.#tools.get(upper);
    if (taken !== undefined && taken !== toolId) {
      // The split ToolRegistry uses: Vite re-runs modules on save, so a dev
      // build warns; a production bundle runs each module once, so there a
      // clash means two tools really claim one key.
      if (!import.meta.env?.DEV) {
        throw new Error(`The key "${upper}" already picks the "${taken}" tool.`);
      }
      console.warn(`[ToolShortcutRegistry] "${upper}" moves from "${taken}" to "${toolId}". Expected during hot reload.`);
    }
    this.#tools.set(upper, toolId);
    this.#keys.set(toolId, upper);
  }

  /** @param {string} toolId @returns {string|null} The key, upper case. */
  static keyFor(toolId) {
    return this.#keys.get(toolId) ?? null;
  }

  /** @param {string} key @returns {string|null} The tool id, case ignored. */
  static toolFor(key) {
    if (typeof key !== 'string' || key.length !== 1) return null;
    return this.#tools.get(key.toUpperCase()) ?? null;
  }
}
