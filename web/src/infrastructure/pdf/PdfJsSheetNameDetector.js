import * as pdfjs from 'pdfjs-dist';
// The same worker setup as PdfJsDocumentSource — without it getDocument()
// hangs with no error. Set here too because this module may load first.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { SheetName } from '../../domain/sheets/SheetName';
import { findSheetName } from '../../domain/sheets/findSheetName';
import { SheetNameDetector } from '../../domain/ports/SheetNameDetector';
import { toSheetTextItems } from './sheetTextItems';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Reads every page's title block with pdf.js.
 *
 * It loads its own copy of the drawing rather than reaching into the one on
 * screen: the reader runs once per drawing, in the background, and keeping it
 * apart means the viewer's document is never held open by it, nor slowed.
 *
 * One page at a time, giving the browser a turn between pages, so a 150-sheet
 * set is read without the sheet on screen stuttering while someone pans it.
 */
export class PdfJsSheetNameDetector extends SheetNameDetector {
  async detect(bytes, { signal } = {}) {
    // pdf.js detaches the buffer it is given; the caller may still need theirs.
    const document = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    const names = [];

    try {
      for (let pageIndex = 0; pageIndex < document.numPages; pageIndex++) {
        if (signal?.aborted) break;

        const page = await document.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const found = findSheetName(toSheetTextItems(content.items, viewport.transform), {
          width: viewport.width,
          height: viewport.height,
        });
        if (found) names.push(new SheetName({ pageIndex, number: found.number, title: found.title }));
        page.cleanup();

        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      await document.destroy();
    }

    return names;
  }
}
