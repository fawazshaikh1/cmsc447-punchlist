/**
 * One drawing replacing another (SCRUM-90): the revised set, and the set it
 * replaces. Kept by the server; a set's history is the chain of these.
 */
export class RevisionLink {
  /**
   * @param {object} fields
   * @param {number} fields.documentId The revised drawing.
   * @param {number} fields.revisionOf The drawing it replaces.
   * @param {Date} fields.linkedAt
   */
  constructor({ documentId, revisionOf, linkedAt }) {
    this.documentId = documentId;
    this.revisionOf = revisionOf;
    this.linkedAt = linkedAt;
    Object.freeze(this);
  }

  /** @param {{ documentId: number, revisionOf: number, linkedAt: string }} row */
  static fromJSON(row) {
    return new RevisionLink({
      documentId: Number(row.documentId),
      revisionOf: Number(row.revisionOf),
      linkedAt: new Date(row.linkedAt),
    });
  }
}
