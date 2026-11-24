import { StandardFonts, rgb } from 'pdf-lib';

import { CalendarDate } from '../../domain/details/CalendarDate';
import { sanitize, statusColor, wrap } from './PunchListPageWriter';

/**
 * One page per punch item, after the schedule (SCRUM-88, FR-6.4, D2).
 *
 * The schedule says what is wrong and where in a line. The detail page is
 * what an architect or a subcontractor reads to act on one item: its number,
 * status and sheet, the whole description, every recorded field, and its
 * photos — embedded in the file, not linked, because a photo that only exists
 * in the app is a photo the person holding the PDF never sees (D2).
 *
 * Photos are those attached to the item (ItemPhotoRepository), read once for
 * the whole project. Without a repository — browser mode — the pages are still
 * written, with no photos. A photo whose bytes cannot be loaded is drawn as a
 * named gap rather than failing the issue: the reviewer sees something was
 * there and can ask. More photos than fit continue on the next page, headed
 * "(continued)", so no photo is ever left out.
 *
 * Every string drawn goes through the schedule's `sanitize`/`wrap`, for the
 * same reason as there: the standard fonts throw on characters outside
 * WinAnsi, and descriptions are typed by anyone.
 */
export class PunchListDetailWriter {
  /**
   * @param {object} [options]
   * @param {import('../../domain/ports/ItemPhotoRepository').ItemPhotoRepository|null} [options.itemPhotos]
   */
  constructor({ itemPhotos = null } = {}) {
    this.itemPhotos = itemPhotos;
  }

  /**
   * @param {import('pdf-lib').PDFDocument} pdfDoc
   * @param {import('../../domain/punchlist/PunchListEntry').PunchListEntry[]} entries
   * @param {object} context
   * @param {string} [context.documentName]
   * @param {(key: string) => Promise<Blob|null>} [context.loadMedia]
   * @param {number|null} [context.projectId] Whose item photos to read.
   * @returns {Promise<number>} Pages added.
   */
  async append(pdfDoc, entries, { documentName = '', loadMedia = async () => null, projectId = null } = {}) {
    if (!entries || entries.length === 0) return 0;

    const photosByItem = this.itemPhotos && projectId !== null ? await this.itemPhotos.listForProject(projectId) : new Map();
    const fonts = {
      regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    };
    const [width, height] = pdfDoc.getPageCount() > 0
      ? [pdfDoc.getPage(0).getWidth(), pdfDoc.getPage(0).getHeight()]
      : [612, 792];
    const layout = layoutFor(width, height);
    const images = new Map();
    const image = async (photo) => {
      if (!images.has(photo.media.key)) images.set(photo.media.key, await embedPhoto(pdfDoc, photo, loadMedia));
      return images.get(photo.media.key);
    };

    let added = 0;
    for (const entry of entries) {
      added += await this.#drawItem(pdfDoc, entry, photosByItem.get(entry.itemId) ?? [], { layout, fonts, image, documentName });
    }
    return added;
  }

  async #drawItem(pdfDoc, entry, photos, { layout, fonts, image, documentName }) {
    const { regular, bold } = fonts;
    const { width, height, margin, size } = layout;
    let pages = 0;

    const newPage = (continued) => {
      const page = pdfDoc.addPage([width, height]);
      pages += 1;
      let y = height - margin;
      write(page, `ITEM ${entry.number}${continued ? ' (continued)' : ''}`, { x: margin, y: y - size.title, size: size.title, font: bold, color: INK });
      const where = `${entry.sheetLabel}${documentName ? `  -  ${documentName}` : ''}`;
      const whereWidth = regular.widthOfTextAtSize(sanitize(where), size.body);
      write(page, where, { x: width - margin - whereWidth, y: y - size.title, size: size.body, font: regular, color: MUTED });
      y -= size.title + layout.gap;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: RULE });
      write(page, `${documentName ? `${documentName}  -  ` : ''}item ${entry.number}`, {
        x: margin, y: margin / 2, size: size.small, font: regular, color: MUTED,
      });
      return { page, y: y - layout.gap };
    };

    let { page, y } = newPage(false);

    // Status, the description, then what is recorded about it.
    write(page, String(entry.status).toUpperCase(), { x: margin, y: y - size.body, size: size.body, font: bold, color: statusColor(entry.statusKey) });
    y -= size.body + layout.gap;
    for (const line of wrap(entry.descriptionForPrint, layout.contentWidth, size.heading, bold)) {
      write(page, line, { x: margin, y: y - size.heading, size: size.heading, font: bold, color: INK });
      y -= size.heading * 1.3;
    }
    y -= layout.gap / 2;
    const facts = [
      entry.raisedOn ? `Raised on: ${entry.raisedOn}` : null,
      ...entry.details.map(({ label, value }) => `${label}: ${value}`),
    ].filter(Boolean);
    for (const fact of facts) {
      for (const line of wrap(fact, layout.contentWidth, size.body, regular)) {
        write(page, line, { x: margin, y: y - size.body, size: size.body, font: regular, color: INK });
        y -= size.body * 1.4;
      }
    }

    // The photos.
    y -= layout.gap;
    const count = photos.length;
    write(page, count === 0 ? 'No photos attached.' : `${count} photo${count === 1 ? '' : 's'}`, {
      x: margin, y: y - size.body, size: size.body, font: bold, color: count === 0 ? MUTED : INK,
    });
    y -= size.body + layout.gap;

    let next = 0;
    while (next < count) {
      const rows = Math.floor((y - layout.bottom + layout.gap) / (layout.cell.height + layout.gap));
      if (rows < 1) {
        ({ page, y } = newPage(true));
        continue;
      }
      const capacity = rows * layout.columns;
      for (let slot = 0; slot < capacity && next < count; slot++, next++) {
        const column = slot % layout.columns;
        const row = Math.floor(slot / layout.columns);
        const x = layout.margin + column * (layout.cell.width + layout.gap);
        const top = y - row * (layout.cell.height + layout.gap);
        await drawPhoto(page, photos[next], await image(photos[next]), { x, top, layout, fonts });
      }
      if (next < count) ({ page, y } = newPage(true));
    }

    return pages;
  }
}

// --- drawing -------------------------------------------------------------------

const INK = rgb(0.1, 0.13, 0.18);
const MUTED = rgb(0.45, 0.48, 0.52);
const RULE = rgb(0.82, 0.84, 0.86);

/** Every dimension, from the sheet's size. Type grows more slowly than the page, as on the schedule. */
function layoutFor(width, height) {
  const s = width / 612;
  const t = Math.sqrt(s);
  const margin = 54 * s;
  const gap = 10 * t;
  const contentWidth = width - margin * 2;
  const columns = 2;
  const cellWidth = (contentWidth - gap * (columns - 1)) / columns;
  const size = { title: 18 * t, heading: 13 * t, body: 10 * t, small: 8 * t };
  // A photo plus two lines under it: its caption, and who added it and when.
  const imageHeight = cellWidth * 0.62;
  return {
    width,
    height,
    margin,
    gap,
    contentWidth,
    columns,
    size,
    bottom: margin,
    cell: { width: cellWidth, imageHeight, height: imageHeight + size.small * 3.6 },
  };
}

async function drawPhoto(page, photo, embedded, { x, top, layout, fonts }) {
  const { cell, size } = layout;
  const boxBottom = top - cell.imageHeight;
  if (embedded) {
    const scale = Math.min(cell.width / embedded.width, cell.imageHeight / embedded.height);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    page.drawImage(embedded, { x: x + (cell.width - w) / 2, y: top - h, width: w, height: h });
  } else {
    page.drawRectangle({ x, y: boxBottom, width: cell.width, height: cell.imageHeight, borderColor: RULE, borderWidth: 1 });
    write(page, 'Photo not available', { x: x + 8, y: boxBottom + cell.imageHeight / 2, size: size.body, font: fonts.regular, color: MUTED });
  }
  let y = boxBottom - size.small * 1.3;
  if (photo.caption) {
    const [line] = wrap(photo.caption, cell.width, size.small, fonts.bold);
    write(page, line, { x, y, size: size.small, font: fonts.bold, color: INK });
    y -= size.small * 1.3;
  }
  const when = photo.addedAt instanceof Date && !Number.isNaN(photo.addedAt.valueOf()) ? `, ${CalendarDate.fromLocalDate(photo.addedAt)}` : '';
  const [credit] = wrap(`Added by ${photo.addedBy}${when}`, cell.width, size.small, fonts.regular);
  write(page, credit, { x, y, size: size.small, font: fonts.regular, color: MUTED });
}

/** The stored photo, embedded once — or null when it cannot be read. */
async function embedPhoto(pdfDoc, photo, loadMedia) {
  try {
    const blob = await loadMedia(photo.media.key);
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return photo.media.mimeType === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  } catch {
    return null;
  }
}

/** `drawText` that cannot throw on a character outside WinAnsi. */
function write(page, value, options) {
  page.drawText(sanitize(value), options);
}
