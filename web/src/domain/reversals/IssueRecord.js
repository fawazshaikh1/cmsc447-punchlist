/**
 * One issued (flattened) PDF, for the admin's Issue history (spec 8.3): when,
 * by whom, how many markups it locked — and, once voided, who voided it, when
 * and why.
 *
 * A void does not delete the issue. The PDF may already be in a
 * subcontractor's inbox, and the log has to keep saying it went out; what the
 * void changes is that its markups are no longer locked by it.
 */
export class IssueRecord {
  /**
   * @param {object} fields
   * @param {string} fields.id
   * @param {string} fields.documentName
   * @param {Date} fields.exportedAt
   * @param {string} fields.exportedBy
   * @param {number} fields.sealedCount
   * @param {{ by: string, at: Date, reason: string }|null} fields.voided
   */
  constructor({ id, documentName, exportedAt, exportedBy, sealedCount, voided }) {
    this.id = id;
    this.documentName = documentName;
    this.exportedAt = exportedAt;
    this.exportedBy = exportedBy;
    this.sealedCount = sealedCount;
    this.voidedBy = voided?.by ?? null;
    this.voidedAt = voided?.at ?? null;
    this.voidReason = voided?.reason ?? null;
    Object.freeze(this);
  }

  /** @returns {boolean} */
  get isVoid() {
    return this.voidedAt !== null;
  }

  /**
   * @param {{ id: string, documentName: string, exportedAt: string, exportedBy: string, sealedCount: number,
   *           void: { by: string, at: string, reason: string }|null }} row
   */
  static fromJSON(row) {
    const voided = row.void
      ? { by: String(row.void.by ?? ''), at: new Date(row.void.at), reason: String(row.void.reason ?? '') }
      : null;
    return new IssueRecord({
      id: row.id,
      documentName: row.documentName,
      exportedAt: new Date(row.exportedAt),
      exportedBy: row.exportedBy ?? '',
      sealedCount: Number(row.sealedCount) || 0,
      voided,
    });
  }
}
