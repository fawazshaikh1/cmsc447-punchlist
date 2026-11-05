import { SheetName } from '../../domain/sheets/SheetName';
import { findSheetName } from '../../domain/sheets/findSheetName';
import { toSheetTextItems } from './sheetTextItems';

/**
 * Names every page of a drawing pdf.js is loading.
 *
 * Takes the LOADING TASK rather than the document, because that is what has
 * to be destroyed afterwards: pdf.js 6 has no `destroy()` on the document
 * proxy (PdfJsDocumentSource met the same thing). The first version of this
 * reader called the document's, threw on the way out, and so never named a
 * single drawing.
 *
 * One page at a time, giving the browser a turn between pages, so a
 * 150-sheet set is read without the sheet on screen stuttering. Free of pdf.js
 * itself — it only calls what a loading task offers — so it is checked in
 * Node with a stand-in.
 *
 * @param {{ promise: Promise<any>, destroy: () => Promise<void>|void }} loadingTask
 *        What `pdfjs.getDocument()` returns.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<SheetName[]>}
 */
export async function readSheetNames(loadingTask, { signal } = {}) {
  const names = [];

  try {
    const document = await loadingTask.promise;

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
      page.cleanup?.();

      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await loadingTask.destroy();
  }

  return names;
}
