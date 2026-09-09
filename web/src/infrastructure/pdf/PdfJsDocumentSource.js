import * as pdfjs from 'pdfjs-dist';
// Vite resolves `?url` to the emitted asset path. pdf.js parses documents on a
// Web Worker; WITHOUT THIS LINE `getDocument()` hangs forever with no error and
// nothing in the console. It is the single most common pdf.js setup failure.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { PageGeometry } from '../../domain/geometry/PageGeometry';
import { SourceAnnotation } from '../../domain/annotations/SourceAnnotation';
import { SheetPage, LoadedDocument, DocumentSource } from '../../domain/ports/DocumentSource';
import { PdfJsCoordinateTransformer } from './PdfJsCoordinateTransformer';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * One page of a pdf.js-loaded document. TIER 3 adapter for SheetPage.
 */
class PdfJsSheetPage extends SheetPage {
  /**
   * @param {number} pageIndex Zero-based.
   * @param {object} page A pdf.js PDFPageProxy.
   */
  constructor(pageIndex, page) {
    super();
    this.pageIndex = pageIndex;
    this.page = page;

    // `view` is the MediaBox as [x0, y0, x1, y1] in PDF points. Width and
    // height are the DIFFERENCES, not x1/y1 — a MediaBox with a non-zero
    // origin is legal and does occur in sets exported from CAD tools.
    const [x0, y0, x1, y1] = page.view;
    this.geometry = new PageGeometry(x1 - x0, y1 - y0, normalizeRotation(page.rotate));
  }

  getPageIndex() {
    return this.pageIndex;
  }

  getGeometry() {
    return this.geometry;
  }

  /**
   * @param {number} scale
   * @param {number} rotation User-applied rotation, ADDED to the page's own.
   * @returns {PdfJsCoordinateTransformer}
   */
  createTransformer(scale, rotation) {
    return new PdfJsCoordinateTransformer(
      this.page.getViewport({ scale, rotation: this.#totalRotation(rotation) }),
    );
  }

  /**
   * Paints the page, sizing the canvas correctly for the display density.
   *
   * =========================================================================
   * THE devicePixelRatio DANCE — do not simplify this
   * =========================================================================
   * A canvas has two sizes. The BITMAP (`canvas.width`) is what you draw into.
   * The CSS BOX (`canvas.style.width`) is how large it appears. Setting only
   * the bitmap gives a sharp but wrongly-sized element; setting only the CSS
   * box gives a correctly-sized but blurry one on any retina screen — and an
   * iPad is always retina.
   *
   * We set the bitmap to `cssSize * dpr`, the CSS box to `cssSize`, and scale
   * the drawing context by `dpr` so pdf.js can keep drawing in CSS units. The
   * payoff is that coordinate conversion continues to take CSS pixels, so the
   * whole coordinate path stays density-independent.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {number} scale
   * @param {number} rotation
   * @returns {{ completed: Promise<void>, cancel: () => void }}
   */
  render(canvas, scale, rotation) {
    const viewport = this.page.getViewport({ scale, rotation: this.#totalRotation(rotation) });
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not acquire a 2D context for the sheet canvas.');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Both `canvas` and `canvasContext` are supplied: pdfjs-dist 6.x wants the
    // element, older versions want only the context. Passing both keeps this
    // adapter working across the range without version sniffing.
    const task = this.page.render({ canvas, canvasContext: context, viewport });

    return {
      // KNOWN pdfjs-dist 6.3.x BEHAVIOUR: this promise can remain pending long
      // after the canvas has finished painting. Callers MUST NOT await it
      // before building the annotation overlay, or the overlay never appears
      // and it looks like the coordinate code is broken. It is exposed only so
      // failures can be observed, and pre-caught so a cancellation never
      // surfaces as an unhandled rejection.
      completed: task.promise.catch((error) => {
        if (isCancellation(error)) return;
        throw error;
      }),
      cancel: () => {
        try {
          task.cancel();
        } catch {
          // Cancelling an already-finished task throws in some versions.
          // There is nothing meaningful to do about it.
        }
      },
    };
  }

  /**
   * Reads the annotations already present in the source PDF.
   *
   * ---------------------------------------------------------------------------
   * WHAT IS FILTERED OUT, AND WHY
   * ---------------------------------------------------------------------------
   *   Popup   Not a visual annotation — it is the pop-up WINDOW belonging to
   *           another one. Drawing it would put an empty box next to every
   *           sticky note.
   *   Link    Navigation, not a markup. Every sheet index in a 153-page set is
   *           a Link, so showing them would bury the real comments.
   *   Hidden  Bit 2 of `/F`. The document author explicitly said not to draw it.
   *
   * Everything is read defensively: pdf.js's annotation shape has changed
   * across major versions (`contents` became `contentsObj`, `title` became
   * `titleObj`), and a drawing set is not worth failing to open because one
   * comment had an unexpected field.
   *
   * @returns {Promise<SourceAnnotation[]>}
   */
  async getSourceAnnotations() {
    let raw;
    try {
      raw = await this.page.getAnnotations();
    } catch (error) {
      // A malformed annotation dictionary should cost the annotation layer,
      // not the ability to view the drawing.
      console.warn('[pdf] Could not read existing annotations:', error);
      return [];
    }

    const IGNORED = new Set(['Popup', 'Link']);
    const HIDDEN_FLAG = 2;

    return (raw ?? [])
      .filter((a) => a && !IGNORED.has(a.subtype))
      .filter((a) => !(Number(a.annotationFlags ?? 0) & HIDDEN_FLAG))
      .map((a) => {
        const [x1, y1, x2, y2] = a.rect ?? [0, 0, 0, 0];
        return new SourceAnnotation({
          id: String(a.id ?? `${this.pageIndex}:${x1}:${y1}`),
          subtype: String(a.subtype ?? 'Unknown'),
          bounds: {
            // A PDF /Rect is not guaranteed to be given lower-left first, so
            // normalise rather than trusting the order.
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          },
          contents: readString(a.contentsObj ?? a.contents),
          author: readString(a.titleObj ?? a.title),
          color: readColor(a.color),
        });
      });
  }

  /**
   * The page's intrinsic `/Rotate` plus the user's, normalised to 0..270.
   *
   * =========================================================================
   * BUG THIS PREVENTS — found during the spike, worth understanding
   * =========================================================================
   * pdf.js treats `getViewport({ rotation })` as the ABSOLUTE rotation, and
   * defaults it to the page's own `/Rotate`. Passing the user's rotation
   * straight through therefore OVERWRITES the page's value — so a sheet
   * authored with `/Rotate 90` renders un-rotated (i.e. sideways) at the
   * default view, and the "Rotate 90" button appears to do nothing on it.
   *
   * Combining them here keeps the contract honest: `rotation` means "how far
   * the user turned it from how the document says it should look".
   *
   * @param {number} userRotation
   * @returns {number}
   */
  #totalRotation(userRotation) {
    return (this.geometry.rotation + userRotation) % 360;
  }
}

/** A pdf.js document. TIER 3 adapter for LoadedDocument. */
class PdfJsLoadedDocument extends LoadedDocument {
  /** @param {object} document A pdf.js PDFDocumentProxy. */
  constructor(document) {
    super();
    this.document = document;
  }

  getPageCount() {
    return this.document.numPages;
  }

  /**
   * @param {number} pageIndex ZERO-based. pdf.js itself is 1-based; the
   *        conversion happens here so the rest of the app never has to think
   *        about it.
   * @returns {Promise<PdfJsSheetPage>}
   */
  async getPage(pageIndex) {
    const count = this.getPageCount();
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= count) {
      throw new RangeError(`Page ${pageIndex} is out of range (0..${count - 1}).`);
    }
    return new PdfJsSheetPage(pageIndex, await this.document.getPage(pageIndex + 1));
  }

  /**
   * Releases the Web Worker backing this document.
   *
   * =========================================================================
   * BUG THIS FIXES — opening a SECOND drawing broke the app
   * =========================================================================
   * This used to call `this.document.destroy()`. **`PDFDocumentProxy.destroy()`
   * does not exist in pdfjs-dist 6.x** — the worker is owned by the loading
   * task, not the document proxy. So the call threw `destroy is not a
   * function`, and because `useSheetDocument` disposes the old document inside
   * the same try block that loads the new one, the throw was caught as a LOAD
   * failure. The user opened a second drawing and got an error and a blank
   * screen, with a message about `destroy` that had nothing to do with the file
   * they had just chosen.
   *
   * It survived every test because disposal only runs on the SECOND open, and
   * testing always started from a fresh page load.
   *
   * Failure to release a worker is now logged and swallowed: leaking one worker
   * is a minor cost, whereas failing to open the drawing the user asked for is
   * the whole application not working.
   */
  dispose() {
    try {
      // Kept version-tolerant: if a future release restores `destroy` on the
      // proxy, that path is preferred; otherwise the loading task owns it.
      if (typeof this.document.destroy === 'function') {
        void this.document.destroy();
      } else {
        void this.document.loadingTask?.destroy();
      }
    } catch (error) {
      console.warn('[pdf] Could not release the document worker:', error);
    }
  }
}

/**
 * DocumentSource backed by Mozilla's pdf.js. TIER 3.
 *
 * This file and PdfJsCoordinateTransformer are the ONLY two in the codebase
 * that import pdfjs-dist. Everything above works against the domain contracts,
 * so replacing the render engine — or stubbing it out in a test — means writing
 * one new adapter and changing one line in the composition root.
 */
export class PdfJsDocumentSource extends DocumentSource {
  /**
   * @param {ArrayBuffer} data
   * @returns {Promise<PdfJsLoadedDocument>}
   */
  async load(data) {
    // pdf.js takes ownership of and DETACHES the buffer it is given, so we hand
    // it a copy. Without this, a caller that retains the ArrayBuffer — to
    // upload it to S3, say — finds it mysteriously zero-length afterwards.
    const bytes = new Uint8Array(data.slice(0));

    try {
      const document = await pdfjs.getDocument({ data: bytes }).promise;
      return new PdfJsLoadedDocument(document);
    } catch (error) {
      throw new Error(`Could not open this PDF: ${describe(error)}`, { cause: error });
    }
  }
}

/**
 * pdf.js has returned annotation text as a bare string in some versions and as
 * `{ str, dir }` in others. Accept either, and anything else becomes ''.
 */
function readString(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.str === 'string') return value.str;
  return '';
}

/**
 * pdf.js gives colour as a Uint8ClampedArray of 0-255 components, or null when
 * the annotation declares none. Converted to hex so it drops straight into SVG
 * and matches how MarkupStyle stores colour.
 */
function readColor(value) {
  if (!value || value.length < 3) return null;
  const hex = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(value[0])}${hex(value[1])}${hex(value[2])}`;
}

/** pdf.js reports `/Rotate` as any multiple of 90, including negatives. */
function normalizeRotation(degrees) {
  const normalized = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return normalized;
}

function isCancellation(error) {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

function describe(error) {
  if (error instanceof Error) {
    // pdf.js signals these with dedicated error names. Both are expected
    // conditions for a real drawing set rather than bugs, so they get plain
    // English that can be shown directly to a user.
    if (error.name === 'PasswordException') return 'it is password-protected.';
    if (error.name === 'InvalidPDFException') return 'the file is not a valid PDF.';
    return error.message;
  }
  return String(error);
}
