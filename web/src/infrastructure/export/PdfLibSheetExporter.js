import { PDFDocument, StandardFonts } from 'pdf-lib';

import { SheetExporter } from '../../domain/ports/SheetExporter';
import { assignOrdinals } from '../../domain/punchlist';
import { PdfWriterRegistry } from './PdfWriterRegistry';
import { ensureDefaultFontResource } from './pdfPrimitives';

// Loading this barrel is what registers all six writers. Without it, export
// throws "No PDF writer registered" on the first annotation.
import './writers';

/**
 * SheetExporter backed by pdf-lib. TIER 3.
 *
 * ===========================================================================
 * THE CENTRAL GUARANTEE: the drawing is never modified
 * ===========================================================================
 * This class only ever APPENDS annotation dictionaries to each page's `/Annots`
 * array. It never touches a content stream, never re-encodes an image, never
 * re-lays-out text. The consequence is that a 153-page, hundred-megabyte
 * drawing set comes back out with every page byte-identical and a few kilobytes
 * of annotations added.
 *
 * That is also why pdf-lib's high-level drawing API (`page.drawRectangle` and
 * friends) is deliberately unused: those paint into the page content stream,
 * which would modify the drawing and permanently flatten the markup into it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS IN THE BROWSER
 * ---------------------------------------------------------------------------
 * No server is required, which means export works in Sprint 1 before the Go API
 * exists, and keeps working offline in a basement with no signal. The cost is
 * that a very large document is held in browser memory during the save.
 *
 * When that becomes a problem, this class moves behind a job queue as a Node
 * worker — and because it implements the SheetExporter contract, that migration
 * is a new adapter plus one line in the composition root. The pdf-lib code
 * itself runs unchanged under Node.
 */
export class PdfLibSheetExporter extends SheetExporter {
  /**
   * @param {object} [options]
   * @param {import('../../domain/ports/MediaStore').MediaStore} [options.media]
   *        Where photo bytes are read from during export. Optional so an
   *        exporter with no photos to embed needs no wiring — a drawing marked
   *        up with boxes and clouds exports identically without it.
   */
  constructor({ media = null } = {}) {
    super();
    this.media = media;
  }


  /**
   * @param {import('../../domain/ports/SheetExporter').ExportRequest} request
   * @returns {Promise<Uint8Array>}
   */
  async exportAnnotated({ sourceBytes, pages, author }) {
    // `slice(0)` because pdf-lib may take ownership of the buffer, and the
    // caller almost certainly still needs the original for the on-screen viewer.
    // `updateMetadata: false` stops pdf-lib rewriting the document's
    // ModDate/Producer — we are annotating someone's drawing set, not claiming
    // authorship of it.
    const pdfDoc = await PDFDocument.load(sourceBytes.slice(0), { updateMetadata: false });

    // Embedded once per document, not once per annotation: a sheet with forty
    // text callouts would otherwise carry forty copies of Helvetica.
    // Helvetica is one of the 14 standard PDF fonts, so this adds no font data
    // to the file at all — only a reference.
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Declares that font in the AcroForm default resources under the same name
    // our `/DA` strings use. Without this, Acrobat cannot resolve the font a
    // FreeText annotation asks for and renders no text at all. See
    // ensureDefaultFontResource for the full explanation.
    ensureDefaultFontResource(pdfDoc, font);

    const pageCount = pdfDoc.getPageCount();

    // Numbered the same way the flattened export numbers, so a pin is item 7 in
    // both files. A working copy and the issued PDF that follows it have to
    // agree about which item is which, or a comment on one cannot be matched to
    // a mark on the other.
    const ordinals = assignOrdinals(pages);

    for (const { pageIndex, annotations } of pages) {
      // Defensive: a stale sheet id could reference a page that no longer
      // exists if the drawing set was re-issued with fewer sheets. Skipping is
      // right here — losing markups from a deleted page is expected, and
      // throwing would block the export of every other page.
      if (pageIndex < 0 || pageIndex >= pageCount) {
        console.warn(`[export] Skipping annotations for missing page ${pageIndex}.`);
        continue;
      }

      const page = pdfDoc.getPage(pageIndex);

      // A sequential `for` rather than `forEach`, because one writer is async:
      // the photo writer reads bytes and embeds an image. `forEach` cannot await,
      // so the annotations would be scheduled and the document saved before any
      // of them had finished — an export with every photo missing.
      //
      // Sequential rather than Promise.all on purpose: pdf-lib's document is
      // mutable shared state, and appending to /Annots from several concurrent
      // writers is not something it promises to survive. Photos are few per
      // sheet, so the lost parallelism is not worth the risk.
      for (let index = 0; index < annotations.length; index++) {
        const annotation = annotations[index];

        // `index` is the annotation's position within this page, which the pin
        // writer turns into the visible number. Passing it in the context — as
        // opposed to storing it on the annotation — keeps numbering a
        // presentation concern: a pin does not have a number, a pin has a
        // POSITION IN A LIST, and that changes when an earlier one is deleted.
        //
        // Throws on an unregistered kind rather than skipping. Silently
        // dropping a markup from a file about to be sent to a client is data
        // loss, and the user would not find out until the client asked.
        await PdfWriterRegistry.write(annotation, {
          pdfDoc,
          page,
          author,
          font,
          index,
          // The number this markup carries among others of ITS OWN kind, across
          // the whole document. A pin numbered by its position in the sheet's
          // annotation list was numbered by how many boxes happened to be drawn
          // first — see assignOrdinals.
          ordinal: ordinals.get(annotation),
          // How a writer reaches image bytes. A function rather than the
          // store itself, so a writer cannot delete or overwrite media
          // while exporting — it can only read.
          loadMedia: (key) => this.media?.get(key) ?? Promise.resolve(null),
        });
      }
    }

    return pdfDoc.save();
  }
}
