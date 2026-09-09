/**
 * @typedef {object} WriteContext
 * @property {import('pdf-lib').PDFDocument} pdfDoc
 * @property {object} page   The pdf-lib PDFPage being annotated.
 * @property {string} author Shown as the annotation author in Acrobat.
 * @property {object} font   Embedded Helvetica, for annotations needing text.
 *
 * @callback AnnotationWriter
 * @param {import('../../domain/annotations/Annotation').Annotation} annotation
 * @param {WriteContext} context
 * @returns {void}
 */

/**
 * Maps an annotation `kind` to the function that writes it into a PDF.
 *
 * The fourth and final registry. Together they mean an annotation type declares
 * everything about itself in its own four files:
 *
 *   AnnotationRegistry   how to REBUILD it from storage
 *   MarkerRegistry       how to DRAW it on screen
 *   ToolRegistry         how to CREATE it from a gesture
 *   PdfWriterRegistry    how to WRITE it into an exported PDF   <- this one
 *
 * Without this last one, the exporter would need a conditional over every
 * annotation type — and export is exactly the place where such a conditional
 * does the most damage, because a missed branch does not throw. It silently
 * drops the user's markup from the file they are about to send to a client.
 *
 * `write` therefore THROWS on an unknown kind rather than skipping it. That is
 * a deliberate departure from MarkerRegistry, which skips: failing to draw one
 * marker on screen is a cosmetic glitch the user can see, whereas failing to
 * export one is silent data loss they will not discover until it matters.
 */
export class PdfWriterRegistry {
  /** @type {Map<string, AnnotationWriter>} */
  static #writers = new Map();

  constructor() {
    throw new TypeError('PdfWriterRegistry is static and cannot be instantiated.');
  }

  /**
   * @param {string} kind
   * @param {AnnotationWriter} writer
   */
  static register(kind, writer) {
    if (this.#writers.has(kind)) {
      // Same dev/production split as the other registries — Vite re-executes
      // modules on save, and throwing would break hot reload.
      if (!import.meta.env?.DEV) {
        throw new Error(`A PDF writer is already registered for kind "${kind}".`);
      }
      console.warn(`[PdfWriterRegistry] Re-registering "${kind}". Expected during hot reload.`);
    }
    this.#writers.set(kind, writer);
  }

  /**
   * @param {import('../../domain/annotations/Annotation').Annotation} annotation
   * @param {WriteContext} context
   * @throws {Error} if no writer is registered for the annotation's kind —
   *         silently dropping a markup from an export is data loss.
   */
  static write(annotation, context) {
    const writer = this.#writers.get(annotation.getKind());
    if (!writer) {
      throw new Error(
        `No PDF writer registered for annotation kind "${annotation.getKind()}". ` +
          `Known: [${[...this.#writers.keys()].join(', ')}]. Every annotation type ` +
          `must be exportable — add a writer in infrastructure/export/writers/.`,
      );
    }
    writer(annotation, context);
  }

  /** @returns {string[]} */
  static registeredKinds() {
    return [...this.#writers.keys()];
  }
}
