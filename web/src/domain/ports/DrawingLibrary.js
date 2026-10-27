import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — the drawings a project keeps (FR-10).
 *
 * Without it a drawing lived only on the device that opened it: markups went
 * to the server, but the PDF they sit on did not, so a teammate — or the same
 * person on another tablet — had the markups and nothing to put them on. The
 * library is where the PDF goes, uploaded once and opened from anywhere, the
 * way a file is in Acrobat's file view.
 *
 * Every method acts as the signed-in person on the given project. Whether they
 * may is the server's decision, and a refusal arrives as a thrown error
 * carrying its explanation.
 */
export class DrawingLibrary {
  static REQUIRED = ['list', 'add', 'open', 'remove'];

  constructor() {
    enforceContract(this, new.target, DrawingLibrary);
  }

  /**
   * The project's drawings, newest first.
   * @param {number} projectId
   * @returns {Promise<import('../library/LibraryDrawing').LibraryDrawing[]>}
   */
  async list(projectId) {
    return abstractMethod('DrawingLibrary', 'list', projectId);
  }

  /**
   * Adds a PDF under a name. Adding the same file under the same name again
   * returns the drawing already there, so offering a drawing twice is safe.
   *
   * @param {number} projectId
   * @param {string} name What the drawing is called — its sheets' name.
   * @param {Blob} pdf
   * @returns {Promise<import('../library/LibraryDrawing').LibraryDrawing>}
   * @throws when a DIFFERENT file already has that name in the project.
   */
  async add(projectId, name, pdf) {
    return abstractMethod('DrawingLibrary', 'add', projectId, name, pdf);
  }

  /**
   * The drawing's PDF.
   * @param {number} projectId
   * @param {import('../library/LibraryDrawing').LibraryDrawing} drawing
   * @returns {Promise<Blob>}
   */
  async open(projectId, drawing) {
    return abstractMethod('DrawingLibrary', 'open', projectId, drawing);
  }

  /**
   * Takes a drawing out of the library. The markups made on it are kept,
   * filed under its name, so adding it back brings them back.
   *
   * @param {number} projectId
   * @param {import('../library/LibraryDrawing').LibraryDrawing} drawing
   * @returns {Promise<void>}
   */
  async remove(projectId, drawing) {
    return abstractMethod('DrawingLibrary', 'remove', projectId, drawing);
  }
}
