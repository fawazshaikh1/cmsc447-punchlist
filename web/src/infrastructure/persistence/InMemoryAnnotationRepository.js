import { AnnotationRepository } from '../../domain/ports/AnnotationRepository';

/**
 * Volatile repository backed by a Map. TIER 3.
 *
 * The default for unit tests and for any flow where persistence would only get
 * in the way. Deliberately the simplest possible implementation of the
 * contract — its job is to demonstrate that the contract is easy to implement,
 * which is what makes the Sprint 2 swap to HTTP a low-risk change rather than a
 * rewrite.
 *
 * Insertion order is preserved because `Map` guarantees it, which keeps pin
 * numbering stable between renders without needing an explicit sort.
 */
export class InMemoryAnnotationRepository extends AnnotationRepository {
  constructor() {
    super();
    /** @type {Map<string, import('../../domain/annotations/Annotation').Annotation>} */
    this.annotations = new Map();
  }

  async listBySheet(sheetId) {
    return [...this.annotations.values()].filter((a) => a.sheetId === sheetId);
  }

  async save(annotation) {
    this.annotations.set(annotation.id, annotation);
  }

  async delete(id) {
    this.annotations.delete(id);
  }

  async clearSheet(sheetId) {
    for (const [id, annotation] of this.annotations) {
      if (annotation.sheetId === sheetId) this.annotations.delete(id);
    }
  }
}
