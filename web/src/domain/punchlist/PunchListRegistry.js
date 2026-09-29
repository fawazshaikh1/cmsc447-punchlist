import { PunchListEntry } from './PunchListEntry';
import { assignOrdinals } from './ordinals';

/**
 * @callback EntryBuilder
 * @param {import('../annotations/Annotation').Annotation} annotation
 * @param {{ number: number, pageIndex: number }} context
 * @returns {PunchListEntry|null} An entry, or null to leave it off the schedule.
 */

/**
 * Maps an annotation `kind` to the function that turns it into a schedule row.
 *
 * ===========================================================================
 * THE SIXTH REGISTRY, AND WHY IT IS A REGISTRY
 * ===========================================================================
 *   AnnotationRegistry      how to REBUILD it from storage
 *   MarkerRegistry          how to DRAW it on screen
 *   ToolRegistry            how to CREATE it from a gesture
 *   PdfWriterRegistry       how to WRITE it into an exported PDF
 *   AnnotationRuleRegistry  when it is COMPLETE enough to issue
 *   PunchListRegistry       how it reads on the SCHEDULE            <- this one
 *
 * The alternative was `if (annotation instanceof Pin)` inside the page writer.
 * That works today, when a pin is the only schedulable thing, and it is exactly
 * the line someone has to find and edit the day an RFI or a deficiency photo
 * also belongs on the list. Here they add a registration instead.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT EVERY MARKUP IS ON THE SCHEDULE
 * ---------------------------------------------------------------------------
 * A box drawn around a door is not a punch item; it is emphasis. A cloud is a
 * revision boundary. Neither has a state, an owner or a description, and
 * listing them would bury the twelve items that DO need fixing under forty that
 * do not.
 *
 * So the default is to be absent. Registering is how a type says "I am
 * something someone has to act on" — which is a claim only that type can make.
 * Unregistered kinds are skipped in silence, deliberately: unlike
 * PdfWriterRegistry, which throws, a missing entry here loses nothing. The
 * markup is still drawn on the sheet. It simply is not a line item.
 */
export class PunchListRegistry {
  /** @type {Map<string, EntryBuilder>} */
  static #builders = new Map();

  constructor() {
    throw new TypeError('PunchListRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {string} kind
   * @param {EntryBuilder} build
   */
  static register(kind, build) {
    if (this.#builders.has(kind)) {
      // The same dev/production split the other registries use — Vite
      // re-executes modules on save, and throwing would break hot reload.
      if (!import.meta.env?.DEV) {
        throw new Error(`A punch list builder is already registered for kind "${kind}".`);
      }
      console.warn(`[PunchListRegistry] Re-registering "${kind}". Expected during hot reload.`);
    }
    this.#builders.set(kind, build);
  }

  /** @param {string} kind @returns {boolean} */
  static has(kind) {
    return this.#builders.has(kind);
  }

  /**
   * Builds the whole schedule for a document, in page then placement order.
   *
   * The numbering runs across every markup of a kind, not just the scheduled
   * ones, because it has to agree with the number the writer draws inside the
   * pin. Both read the same map — see `assignOrdinals`.
   *
   * @param {{ pageIndex: number, annotations: import('../annotations/Annotation').Annotation[] }[]} pages
   * @param {Map<import('../annotations/Annotation').Annotation, number>} [ordinals]
   *        Reuses the export's numbering when given one. Computing its own is
   *        only correct when nothing else has already numbered these pages.
   * @returns {PunchListEntry[]}
   */
  static collect(pages, ordinals = assignOrdinals(pages)) {
    const entries = [];

    for (const { pageIndex, annotations } of pages) {
      for (const annotation of annotations) {
        const build = this.#builders.get(annotation.getKind());
        if (!build) continue;

        const entry = build(annotation, { number: ordinals.get(annotation), pageIndex });
        if (entry instanceof PunchListEntry) entries.push(entry);
      }
    }

    return entries;
  }

  /** @returns {string[]} */
  static registeredKinds() {
    return [...this.#builders.keys()];
  }
}
