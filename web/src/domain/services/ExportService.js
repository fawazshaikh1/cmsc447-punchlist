import { SheetExporter } from '../ports/SheetExporter';
import { assertInstanceOf } from '../support/contracts';
import { AnnotationService } from './AnnotationService';

/**
 * Use case: produce a PDF of the whole drawing set with every markup embedded
 * as a native annotation.
 *
 * Sits above AnnotationService and SheetExporter and coordinates them. Kept
 * separate from AnnotationService because it is a genuinely different concern —
 * that class is about one sheet's annotations while a user is working, this one
 * is about the whole document at the moment of handover — and because export
 * will grow (a filter for open items only, a per-trade export, a summary page)
 * without that growth belonging in the editing path.
 */
export class ExportService {
  /**
   * @param {AnnotationService} annotations
   * @param {SheetExporter} exporter
   */
  constructor(annotations, exporter) {
    assertInstanceOf(annotations, AnnotationService, 'annotations');
    assertInstanceOf(exporter, SheetExporter, 'exporter');

    this.annotations = annotations;
    this.exporter = exporter;
  }

  /**
   * Gathers every sheet's annotations and writes them into a copy of the
   * original PDF.
   *
   * @param {object} request
   * @param {ArrayBuffer} request.sourceBytes The original, unmodified PDF.
   * @param {number} request.pageCount
   * @param {(pageIndex: number) => string} request.sheetIdFor
   *        Maps a page index to its sheet id. Injected rather than assumed
   *        because the id scheme is a presentation concern today
   *        (`filename#pageIndex`) and becomes a database id in Sprint 2 —
   *        this service should not have to change when it does.
   * @param {string} request.author
   * @param {(done: number, total: number) => void} [request.onProgress]
   *        A 153-page set takes long enough that silence reads as a hang.
   * @returns {Promise<{ bytes: Uint8Array, annotatedPages: number, annotationCount: number }>}
   */
  async exportDocument({ sourceBytes, pageCount, sheetIdFor, author, onProgress }) {
    const pages = [];
    let annotationCount = 0;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const annotations = await this.annotations.listForSheet(sheetIdFor(pageIndex));

      // Only pages that actually carry markups are passed on. On a 153-page set
      // where six sheets were marked, this keeps the exporter's work
      // proportional to the markup rather than to the document.
      if (annotations.length > 0) {
        pages.push({ pageIndex, annotations });
        annotationCount += annotations.length;
      }

      onProgress?.(pageIndex + 1, pageCount);
    }

    const bytes = await this.exporter.exportAnnotated({ sourceBytes, pages, author });

    return { bytes, annotatedPages: pages.length, annotationCount };
  }
}
