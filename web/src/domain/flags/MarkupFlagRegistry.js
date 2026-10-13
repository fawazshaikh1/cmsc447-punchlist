import { assertInstanceOf } from '../support/contracts';
import { MarkupFlag } from './MarkupFlag';

/**
 * Every flag a markup can carry.
 *
 * The sheet and the panel ask this registry which flags apply to a markup and
 * render whatever comes back — so neither has to be edited when a flag is
 * added. Flags are evaluated in registration order, which is the order the
 * panel lists them.
 */
export class MarkupFlagRegistry {
  /** @type {Map<string, MarkupFlag>} */
  static #flags = new Map();

  static #ID = /^[a-z][a-z0-9-]*$/;

  constructor() {
    throw new TypeError('MarkupFlagRegistry is static and cannot be instantiated.');
  }

  /** @param {MarkupFlag} flag */
  static register(flag) {
    assertInstanceOf(flag, MarkupFlag, 'markup flag');

    const id = flag.getId();
    if (typeof id !== 'string' || !MarkupFlagRegistry.#ID.test(id)) {
      throw new TypeError(
        `${flag.constructor.name}.getId() must be lowercase and hyphenated, received ${JSON.stringify(id)}.`,
      );
    }
    if (!MarkupFlag.TONES.includes(flag.getTone())) {
      throw new TypeError(
        `${flag.constructor.name}.getTone() must be one of ${MarkupFlag.TONES.join(', ')}.`,
      );
    }

    if (this.#flags.has(id)) {
      // Same dev/production split as every registry: a duplicate in
      // development is Vite re-running the module on save.
      if (!import.meta.env?.DEV) {
        throw new Error(`A markup flag is already registered under "${id}".`);
      }
      console.warn(`[MarkupFlagRegistry] Re-registering "${id}". Expected during hot reload.`);
    }

    this.#flags.set(id, flag);
  }

  /**
   * The flags that apply to one markup, in registration order. A flag that
   * throws is treated as not applying, so one buggy flag cannot hide the
   * others or break the sheet.
   *
   * @param {import('../annotations/Annotation').Annotation} annotation
   * @param {import('./MarkupFlag').FlagContext} context
   * @returns {MarkupFlag[]}
   */
  static flagsFor(annotation, context) {
    return [...this.#flags.values()].filter((flag) => {
      try {
        return flag.appliesTo(annotation, context) === true;
      } catch (error) {
        console.warn(`[MarkupFlagRegistry] "${flag.getId()}" failed; treating it as not applying.`, error);
        return false;
      }
    });
  }

  /**
   * The most serious tone among some flags, or null when there are none —
   * what the sheet colours a markup by when several flags apply at once.
   *
   * @param {MarkupFlag[]} flags
   * @returns {'info'|'warning'|'danger'|null}
   */
  static strongestTone(flags) {
    let strongest = -1;
    for (const flag of flags) {
      strongest = Math.max(strongest, MarkupFlag.TONES.indexOf(flag.getTone()));
    }
    return strongest < 0 ? null : MarkupFlag.TONES[strongest];
  }

  /** @returns {MarkupFlag[]} */
  static all() {
    return [...this.#flags.values()];
  }
}
