import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';

import { WorkingCopyReader } from '../../domain/ports/WorkingCopyReader';
import {
  annotationAt,
  mightBeWorkingCopy,
  readMarkup,
  removeAnnotation,
  unmarkDocument,
} from './workingCopyFormat';

/**
 * Reads our markups back out of a working copy with pdf-lib. TIER 3.
 *
 * pdf-lib rather than pdf.js because pdf.js only reports the annotation fields
 * it knows how to render — our private key never reaches it — and because the
 * file has to be REWRITTEN without the markups the app takes back, which pdf.js
 * cannot do.
 *
 * Costs nothing for a PDF that is not a working copy: one byte scan, no parse,
 * and the very same buffer handed back. A drawing set that never passed
 * through our exporter is never re-saved by this class.
 */
export class PdfLibWorkingCopyReader extends WorkingCopyReader {
  /**
   * @param {ArrayBuffer} bytes
   * @param {(markup: import('../../domain/ports/WorkingCopyReader').EmbeddedMarkup) => Promise<boolean>|boolean} take
   * @returns {Promise<ArrayBuffer>}
   */
  async read(bytes, take) {
    if (!mightBeWorkingCopy(new Uint8Array(bytes))) return bytes;

    // A copy, because pdf-lib may hold on to what it is given and the caller
    // still needs the original if nothing ends up being taken out.
    const pdfDoc = await PDFDocument.load(bytes.slice(0), { updateMetadata: false });

    let taken = 0;
    let left = 0;

    for (const [pageIndex, page] of pdfDoc.getPages().entries()) {
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!annots) continue;

      // Asked in page order, so restored markups keep the order they were
      // exported in — and with it the numbers drawn inside the pins.
      const leaving = [];
      for (let index = 0; index < annots.size(); index++) {
        const data = readMarkup(annotationAt(annots, index));
        if (!data) continue;

        if (await take({ pageIndex, data })) leaving.push(index);
        else left += 1;
      }

      // Back to front, so removing one does not shift the next one's index.
      for (const index of leaving.reverse()) removeAnnotation(pdfDoc, annots, index);
      taken += leaving.length;
    }

    if (taken === 0) return bytes;

    // Keep the mark while any of our markups are still in the file — a photo
    // left behind because its image is not on this device should be found
    // again on a device that has it.
    if (left === 0) unmarkDocument(pdfDoc);

    const saved = await pdfDoc.save();
    return saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength);
  }
}
