/**
 * @typedef {object} MarkerProps
 * @property {import('../../../domain/annotations/Annotation').Annotation} annotation
 * @property {(point: import('../../../domain/geometry/PdfPoint').PdfPoint) => {x:number,y:number}} project
 *           PDF user space -> the overlay's SVG space. Applies the Y flip and
 *           the current rotation. Markers with geometry beyond the anchor
 *           (corners, paths, arrowheads) MUST project every point through this
 *           rather than adding offsets, or they break at 90 and 270 degrees.
 * @property {number} rotation Current user rotation. Only TextMarker uses it,
 *           to counter-rotate so callouts stay readable.
 * @property {number} x @property {number} y The projected anchor, for convenience.
 * @property {number} ordinal 1-based display number.
 * @property {boolean} isSelected
 * @property {(annotation: object) => void} onSelect
 */

/**
 * Maps an annotation `kind` to the SVG component that draws it.
 *
 * The presentation-tier twin of the domain's AnnotationRegistry, existing for
 * the same reason. The alternative is a conditional inside AnnotationLayer:
 *
 *     {annotation.getKind() === 'pin'       && <PinMarker .../>}
 *     {annotation.getKind() === 'rectangle' && <RectangleMarker .../>}   // Sprint 2
 *
 * which means every new markup type EDITS the component that renders all the
 * others — the exact coupling this architecture exists to prevent, and a
 * guaranteed merge conflict when two people add markup types in the same week.
 *
 * ---------------------------------------------------------------------------
 * ADDING A MARKUP TYPE IN SPRINT 2 is therefore, in full:
 *   1. a domain class that self-registers with AnnotationRegistry
 *   2. an SVG component that self-registers here
 *   3. one export line in domain/annotations/index.js
 *   4. one export line in components/markers/index.js
 * and nothing else in the codebase changes.
 */
export class MarkerRegistry {
  /** @type {Map<string, React.ComponentType<object>>} */
  static #components = new Map();

  constructor() {
    throw new TypeError('MarkerRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {string} kind Must match the domain class's `getKind()`.
   * @param {React.ComponentType<object>} component
   */
  static register(kind, component) {
    // Same dev/production split as AnnotationRegistry.register, and for the same
    // reason: Vite re-executes modules on every save, so throwing here would
    // break hot reload every time somebody edits a marker component. In a
    // production bundle each module runs once, so a duplicate genuinely means
    // two components are claiming one kind — that is a real bug, so fail.
    if (this.#components.has(kind)) {
      if (!import.meta.env?.DEV) {
        throw new Error(`A marker component is already registered for kind "${kind}".`);
      }
      console.warn(
        `[MarkerRegistry] Re-registering "${kind}". Expected during hot reload; ` +
          `if you see this in a fresh page load, two components share a kind.`,
      );
    }

    this.#components.set(kind, component);
  }

  /**
   * Returns null for an unregistered kind rather than throwing.
   *
   * Unlike the domain registry — where an unknown kind means data we cannot
   * model, and failing loudly is right — an unknown kind here only means we
   * cannot DRAW it. Skipping one marker is far better than blanking the sheet.
   *
   * @param {string} kind
   * @returns {React.ComponentType<object> | null}
   */
  static resolve(kind) {
    return this.#components.get(kind) ?? null;
  }

  /** @returns {string[]} Diagnostics. */
  static registeredKinds() {
    return [...this.#components.keys()];
  }
}
