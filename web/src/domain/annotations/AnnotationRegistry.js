/**
 * Maps an annotation `kind` back to the class that owns it.
 *
 * ===========================================================================
 * THE PROBLEM THIS SOLVES — and why it matters for "add, don't modify"
 * ===========================================================================
 * Deserialisation is where extensible type hierarchies usually rot. The naive
 * version is a switch statement:
 *
 *     switch (dto.kind) {
 *       case 'pin':       return Pin.fromJSON(dto);
 *       case 'rectangle': return Rectangle.fromJSON(dto);   // Sprint 2 edits this
 *       case 'cloud':     return Cloud.fromJSON(dto);       // Sprint 2 edits it again
 *     }
 *
 * Three things go wrong with that:
 *
 *   1. Every new markup type EDITS a file that every existing type depends on,
 *      so adding a cloud can break pins.
 *   2. It becomes a merge-conflict magnet for a team working in parallel.
 *   3. It forces the repository layer to import every concrete annotation
 *      class — low-level code depending on high-level detail, which is the
 *      dependency rule backwards.
 *
 * With a registry, a new annotation type is added by ITS OWN FILE calling
 * `AnnotationRegistry.register(...)`. Nothing else in the codebase changes.
 *
 * ---------------------------------------------------------------------------
 * TRADE-OFF, STATED HONESTLY
 * ---------------------------------------------------------------------------
 * Registration is a side effect of importing the module, so a class that is
 * never imported is never registered, and its stored rows would fail to decode
 * with a confusing runtime error. `domain/annotations/index.js` imports every
 * subclass in one place to make that dependency explicit and greppable rather
 * than accidental.
 */
export class AnnotationRegistry {
  /** @type {Map<string, (dto: object) => import('./Annotation').Annotation>} */
  static #deserializers = new Map();

  /** This class is a namespace and is never instantiated. */
  constructor() {
    throw new TypeError('AnnotationRegistry is static and cannot be instantiated.');
  }

  /**
   * Registers the deserialiser for one annotation kind. Called once per
   * subclass, at module load, from that subclass's own file.
   *
   * @param {string} kind
   * @param {(dto: object) => import('./Annotation').Annotation} deserializer
   * @throws {Error} in a production build, if a kind is registered twice.
   *
   * ---------------------------------------------------------------------------
   * WHY DUPLICATE REGISTRATION IS FATAL IN PRODUCTION BUT NOT IN DEVELOPMENT
   * ---------------------------------------------------------------------------
   * In a production bundle every module executes exactly once, so a second
   * registration for the same kind can only mean two DIFFERENT classes are
   * fighting over one discriminator. Left alone, annotations would decode into
   * whichever class happened to be imported last — a bug that changes behaviour
   * when an unrelated import is reordered, and is miserable to diagnose. Fail
   * loudly instead.
   *
   * In development, Vite's hot module replacement RE-EXECUTES a module every
   * time you save it. Throwing there would mean that editing this file, or any
   * annotation subclass, breaks hot reload with a confusing error and forces a
   * manual refresh — many times an hour, for everyone on the team. So in dev we
   * treat re-registration as what it almost always is (the same class reloaded),
   * replace the entry, and warn rather than throw.
   */
  static register(kind, deserializer) {
    if (typeof kind !== 'string' || kind.length === 0) {
      throw new TypeError('Annotation kind must be a non-empty string.');
    }

    if (this.#deserializers.has(kind)) {
      if (!import.meta.env?.DEV) {
        throw new Error(
          `Annotation kind "${kind}" is already registered. Two classes cannot ` +
            `share a kind — pick a distinct discriminator.`,
        );
      }
      console.warn(
        `[AnnotationRegistry] Re-registering "${kind}". Expected during hot reload; ` +
          `if you see this in a fresh page load, two classes are sharing a kind.`,
      );
    }

    this.#deserializers.set(kind, deserializer);
  }

  /**
   * Rebuilds an annotation from its stored form.
   *
   * @param {object} dto
   * @returns {import('./Annotation').Annotation}
   * @throws {Error} if the kind is unknown. Deliberate: an unknown kind means
   *         the data contains something this build cannot represent — a
   *         teammate shipped a new markup type and this tab is stale. Failing
   *         loudly beats silently dropping a user's markup. Callers that need
   *         resilience should use `tryFromJSON`.
   */
  static fromJSON(dto) {
    const deserializer = this.#deserializers.get(dto?.kind);
    if (!deserializer) {
      throw new Error(
        `Unknown annotation kind "${dto?.kind}". Known kinds: ` +
          `[${[...this.#deserializers.keys()].join(', ')}]. Either the class was ` +
          `never imported, or this client is out of date.`,
      );
    }
    return deserializer(dto);
  }

  /**
   * Non-throwing variant: returns null for kinds this build cannot decode.
   * Used by the repositories, where one unreadable row should not blank a
   * whole sheet.
   *
   * @param {object} dto
   * @returns {import('./Annotation').Annotation | null}
   */
  static tryFromJSON(dto) {
    return this.#deserializers.has(dto?.kind) ? this.fromJSON(dto) : null;
  }

  /** @returns {string[]} Diagnostics — used by the inspector panel. */
  static registeredKinds() {
    return [...this.#deserializers.keys()];
  }
}
