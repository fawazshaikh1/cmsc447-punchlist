import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * CONTRACT — one page of a loaded drawing set, ready to be drawn and measured.
 *
 * NOTE ON `HTMLCanvasElement` APPEARING IN A DOMAIN CONTRACT
 * ---------------------------------------------------------
 * Strict hexagonal architecture would hide the canvas behind yet another
 * abstraction. We deliberately do not, because this is a browser application
 * and the canvas is a platform primitive, not a third-party dependency — the
 * same way we do not abstract `string` or `Date`. What actually matters is that
 * the pdf.js DEPENDENCY stays fully behind this contract, and it does: exactly
 * two files in the codebase import pdfjs-dist.
 */
export class SheetPage {
  static REQUIRED = [
    'getPageIndex',
    'getGeometry',
    'createTransformer',
    'render',
    'getSourceAnnotations',
  ];

  constructor() {
    enforceContract(this, new.target, SheetPage);
  }

  /** @returns {number} Zero-based index of this page in the document. */
  getPageIndex() {
    return abstractMethod('SheetPage', 'getPageIndex');
  }

  /** @returns {import('../geometry/PageGeometry').PageGeometry} */
  getGeometry() {
    return abstractMethod('SheetPage', 'getGeometry');
  }

  /**
   * Builds the screen <-> document converter for one specific view state.
   *
   * Cheap — call it on every scale or rotation change rather than caching one.
   * A transformer is immutable and valid only for the scale and rotation it was
   * built with (see CoordinateTransformer).
   *
   * @param {number} scale 1 = 100%.
   * @param {number} rotation User-applied rotation in degrees, ADDED to the
   *        page's own `/Rotate` rather than replacing it.
   * @returns {import('../geometry/CoordinateTransformer').CoordinateTransformer}
   */
  createTransformer(scale, rotation) {
    return abstractMethod('SheetPage', 'createTransformer', scale, rotation);
  }

  /**
   * Paints this page into a canvas at the given scale and rotation.
   *
   * Sizes the canvas itself, INCLUDING the devicePixelRatio correction, because
   * getting that wrong is the retina bug described on ViewportPoint and it must
   * be fixed in exactly one place.
   *
   * Returns a handle rather than a bare promise so that a render in flight can
   * be cancelled — rapid zoom clicks otherwise queue overlapping renders that
   * finish out of order and paint over each other.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {number} scale
   * @param {number} rotation
   * @returns {{ completed: Promise<void>, cancel: () => void }}
   */
  render(canvas, scale, rotation) {
    return abstractMethod('SheetPage', 'render', canvas, scale, rotation);
  }

  /**
   * Annotations that were ALREADY in the uploaded PDF.
   *
   * These are the comments a reviewer sees when they open the drawing in
   * Chrome or Acrobat — the little yellow sticky notes and boxes. Without this
   * the editor is blind to them, and a user marks up a sheet without knowing
   * the architect has already commented on it.
   *
   * They are read-only and are never re-exported: the exporter copies the
   * original file's bytes, so these are already in the output and writing them
   * again would duplicate every existing comment. See SourceAnnotation.
   *
   * @returns {Promise<import('../annotations/SourceAnnotation').SourceAnnotation[]>}
   */
  getSourceAnnotations() {
    return abstractMethod('SheetPage', 'getSourceAnnotations');
  }
}

/** CONTRACT — a loaded multi-page document. */
export class LoadedDocument {
  static REQUIRED = ['getPageCount', 'getPage', 'dispose'];

  constructor() {
    enforceContract(this, new.target, LoadedDocument);
  }

  /** @returns {number} */
  getPageCount() {
    return abstractMethod('LoadedDocument', 'getPageCount');
  }

  /**
   * @param {number} pageIndex ZERO-based.
   * @returns {Promise<SheetPage>}
   */
  getPage(pageIndex) {
    return abstractMethod('LoadedDocument', 'getPage', pageIndex);
  }

  /**
   * Releases worker resources. Must be called when the document is replaced —
   * pdf.js keeps a Web Worker alive per document, so skipping this leaks one
   * every time the user opens a different drawing.
   * @returns {void}
   */
  dispose() {
    return abstractMethod('LoadedDocument', 'dispose');
  }
}

/**
 * CONTRACT — loads PDF bytes into something renderable.
 *
 * The only doorway through which pdf.js enters the application. Everything
 * above this line works against SheetPage and CoordinateTransformer, which is
 * what makes the domain tier testable with a fake page and no PDF fixture.
 */
export class DocumentSource {
  static REQUIRED = ['load'];

  constructor() {
    enforceContract(this, new.target, DocumentSource);
  }

  /**
   * @param {ArrayBuffer} data Raw PDF bytes.
   * @returns {Promise<LoadedDocument>}
   * @throws if the bytes are not a PDF, or the document is password-protected.
   *         Encrypted drawing sets are explicitly out of scope for Sprint 1 and
   *         are rejected here with a readable message.
   */
  load(data) {
    return abstractMethod('DocumentSource', 'load', data);
  }
}
