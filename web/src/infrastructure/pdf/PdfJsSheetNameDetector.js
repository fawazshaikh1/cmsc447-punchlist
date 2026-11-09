import * as pdfjs from 'pdfjs-dist';
// The same worker setup as PdfJsDocumentSource — without it getDocument()
// hangs with no error. Set here too because this module may load first.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { SheetNameDetector } from '../../domain/ports/SheetNameDetector';
import { readSheetNames } from './readSheetNames';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Reads every page's title block with pdf.js.
 *
 * It loads its own copy of the drawing rather than reaching into the one on
 * screen: the reader runs once per drawing, in the background, and keeping it
 * apart means the viewer's document is never held open by it, nor slowed.
 * The reading itself is `readSheetNames`, which is free of pdf.js and checked
 * on its own.
 */
export class PdfJsSheetNameDetector extends SheetNameDetector {
  async detect(bytes, options = {}) {
    // pdf.js detaches the buffer it is given; the caller may still need theirs.
    return readSheetNames(pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }), options);
  }
}
