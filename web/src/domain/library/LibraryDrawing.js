/**
 * One drawing in a project's library (FR-10.1, FR-10.2): what it is called,
 * how big it is, and who added it when.
 *
 * The name is the file name the drawing was added under, and it is also what
 * the drawing's sheets are named after (see domain/documents/sheetNames) —
 * which is why opening it from the library, on any device, shows the markups
 * already made on it.
 */
export class LibraryDrawing {
  /**
   * @param {object} fields
   * @param {number} fields.id
   * @param {string} fields.name
   * @param {number} fields.byteSize
   * @param {string} [fields.uploadedBy] Display name of who added it.
   * @param {string} fields.uploadedAt ISO 8601.
   */
  constructor({ id, name, byteSize, uploadedBy = '', uploadedAt }) {
    if (!Number.isInteger(id) || id < 1) throw new TypeError('A library drawing needs a positive whole-number id.');
    if (typeof name !== 'string' || name.trim() === '') throw new TypeError('A library drawing needs a name.');
    if (!Number.isFinite(byteSize) || byteSize < 0) throw new TypeError('A library drawing needs its size.');
    if (Number.isNaN(Date.parse(uploadedAt))) throw new TypeError('A library drawing needs the time it was added.');

    this.id = id;
    this.name = name;
    this.byteSize = byteSize;
    this.uploadedBy = uploadedBy;
    this.uploadedAt = uploadedAt;
    Object.freeze(this);
  }

  /** "12.4 MB" — how big a download opening it means, on a site connection. */
  get sizeLabel() {
    const mb = this.byteSize / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(this.byteSize / 1024))} KB`;
  }

  /** @param {{id: number, name: string, byteSize: number, uploadedBy?: string, uploadedAt: string}} dto */
  static fromJSON(dto) {
    return new LibraryDrawing(dto);
  }
}
