/**
 * Which project a sheet belongs to, written into the sheet's id.
 *
 * ===========================================================================
 * WHY THE PROJECT IS PART OF THE ID
 * ===========================================================================
 * A sheet's id is derived from its file name and page — `A-101.pdf#0` — so
 * that it is the same every time the file is opened (see sheetIdentity). With
 * one person on one tablet that is enough. With projects it is not: two
 * projects can each have an `A-101.pdf`, and the server has to know which
 * project a markup is on before it can decide whether the person sending it
 * is allowed to.
 *
 * So inside a project the id gains a prefix: `p12:A-101.pdf#0`. The server
 * reads the project from it (backend/access.go), two projects never collide,
 * and a sheet can never be claimed by a project it is not in. Nothing between
 * here and the server needs to know — an id is still just a string.
 *
 * Browser mode has no projects, and uses `SheetScope.NONE`, which leaves ids
 * exactly as they were. That is also what keeps markups saved in a browser
 * before projects existed findable: they are filed under the bare id, which
 * `localIdOf` recovers from a scoped one.
 */
export class SheetScope {
  /**
   * @param {number|null} projectId
   */
  constructor(projectId) {
    if (projectId !== null && !(Number.isInteger(projectId) && projectId > 0)) {
      throw new TypeError(`A project id is a positive whole number, not ${String(projectId)}.`);
    }
    this.projectId = projectId;
    Object.freeze(this);
  }

  /** No project — browser mode. Ids are left exactly as they are. */
  static get NONE() {
    return NONE;
  }

  /** @param {number} projectId */
  static forProject(projectId) {
    return new SheetScope(projectId);
  }

  /**
   * The id a sheet has inside this scope.
   * @param {string} sheetId The bare id, `file#page`.
   */
  qualify(sheetId) {
    if (this.projectId === null) return sheetId;
    return `p${this.projectId}:${sheetId}`;
  }

  /**
   * The bare id, whatever scope it was written in — how a sheet was filed in
   * the browser before projects existed.
   * @param {string} sheetId
   */
  static localIdOf(sheetId) {
    const match = PREFIX.exec(sheetId);
    return match ? sheetId.slice(match[0].length) : sheetId;
  }

  /**
   * The project an id belongs to, or null for a bare one.
   * @param {string} sheetId
   * @returns {number|null}
   */
  static projectOf(sheetId) {
    const match = PREFIX.exec(sheetId);
    return match ? Number(match[1]) : null;
  }
}

/** Mirrors sheetProject() in backend/access.go: no leading zeros, nothing empty. */
const PREFIX = /^p([1-9]\d*):(?=.)/;

const NONE = new SheetScope(null);
