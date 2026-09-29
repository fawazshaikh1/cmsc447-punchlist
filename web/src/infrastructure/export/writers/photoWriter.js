import { PHOTO_KIND } from '../../../domain/annotations';
import { PdfWriterRegistry } from '../PdfWriterRegistry';
import {
  appendAnnotation,
  createAppearance,
  markupFields,
  num,
  DEFAULT_FONT_NAME,
} from '../pdfPrimitives';

/** Frame stroke width, in points. */
const FRAME = 1.5;

/**
 * Caption type size, as a fraction of the photo's width on the sheet.
 *
 * Fixed at 9pt originally, which is legible beside a small photo and almost
 * invisible beside a large one — and the user can now resize photos freely, so
 * a constant size was never going to hold. Scaling keeps the caption in
 * proportion to the thing it describes, the same reasoning as the cloud's bump
 * count.
 */
const CAPTION_RATIO = 1 / 16;
const CAPTION_MIN = 8;
const CAPTION_MAX = 18;

/** The band is the type size plus room for descenders and a little air. */
const CAPTION_LEADING = 1.8;

/** Frame colour — the same markup red the app uses for an open issue. */
const FRAME_RGB = [0.78, 0.27, 0.17];

/**
 * Writes a photograph into the PDF as a `/Stamp` annotation with the image
 * embedded in its appearance stream.
 *
 * ===========================================================================
 * THE ONLY ASYNCHRONOUS WRITER, AND WHY
 * ===========================================================================
 * The other six compose content-stream operators out of numbers they already
 * hold. This one needs bytes that live in a store, and `pdf-lib`'s embed call
 * reads them. `PdfWriterRegistry.write` awaits whatever a writer returns, so
 * that cost lands here and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * WHY AN IMAGE XOBJECT INSIDE A STAMP, NOT A PAGE-LEVEL DRAW
 * ---------------------------------------------------------------------------
 * Drawing the image straight onto the page would be simpler, and wrong for this
 * product: it would modify the drawing's own content stream. The one constraint
 * this exporter has held since the first sprint is that the architect's page
 * comes out byte-identical, with only annotation objects appended.
 *
 * So the photograph becomes a form XObject referenced from the annotation's
 * appearance. It is still a real markup — it appears in Acrobat's Comments
 * panel, carries the caption as `/Contents`, and can be selected, replied to
 * and resolved — and the drawing underneath is untouched.
 *
 * The flattened exporter then burns this same appearance into the page when the
 * user issues the file, which is how one writer serves both export modes.
 *
 * ---------------------------------------------------------------------------
 * A MISSING PHOTO DOES NOT FAIL THE EXPORT
 * ---------------------------------------------------------------------------
 * Media lives in a different store from annotations, so the two can diverge —
 * cleared browser storage, a device that never synced, a key written by a build
 * that stored it elsewhere. Failing the whole export over one absent image
 * would lose a hundred good markups to one bad one.
 *
 * Instead the frame is drawn with a diagonal cross and the caption says the
 * photo is missing. The reviewer sees that something was there and can ask,
 * which is strictly better than both a crash and a silent omission.
 */
PdfWriterRegistry.register(PHOTO_KIND, async (photo, { pdfDoc, page, author, font, loadMedia }) => {
  const bounds = photo.getBounds();
  const caption = photo.caption.trim();

  const captionSize = Math.min(
    CAPTION_MAX,
    Math.max(CAPTION_MIN, bounds.width * CAPTION_RATIO),
  );
  const captionBand = caption ? captionSize * CAPTION_LEADING : 0;

  // The annotation rectangle covers the image, its frame and the caption band.
  const rect = [
    bounds.left - FRAME,
    bounds.bottom - captionBand - FRAME,
    bounds.right + FRAME,
    bounds.top + FRAME,
  ];

  const blob = await loadMedia(photo.media.key);
  const embedded = blob ? await embedImage(pdfDoc, blob, photo.media.mimeType) : null;

  const ops = [
    // White backing, so a photo with light areas still reads as a placed object
    // rather than floating over the linework.
    '1 1 1 rg',
    `${num(bounds.left)} ${num(bounds.bottom - captionBand)} ${num(bounds.width)} ${num(bounds.height + captionBand)} re`,
    'f',
  ];

  if (embedded) {
    // `cm` maps the unit square the XObject draws into onto the target
    // rectangle: scale by width and height, translate to the bottom-left
    // corner. The q/Q pair keeps that matrix from leaking into the frame below.
    ops.push(
      'q',
      `${num(bounds.width)} 0 0 ${num(bounds.height)} ${num(bounds.left)} ${num(bounds.bottom)} cm`,
      '/PLPhoto Do',
      'Q',
    );
  } else {
    // Missing: a crossed box, so the gap is visible rather than blank.
    ops.push(
      `${num(FRAME_RGB[0])} ${num(FRAME_RGB[1])} ${num(FRAME_RGB[2])} RG`,
      '1 w',
      `${num(bounds.left)} ${num(bounds.bottom)} m ${num(bounds.right)} ${num(bounds.top)} l S`,
      `${num(bounds.left)} ${num(bounds.top)} m ${num(bounds.right)} ${num(bounds.bottom)} l S`,
    );
  }

  // Frame, drawn last so it sits over the image edge rather than under it.
  ops.push(
    `${num(FRAME_RGB[0])} ${num(FRAME_RGB[1])} ${num(FRAME_RGB[2])} RG`,
    `${num(FRAME)} w`,
    `${num(bounds.left)} ${num(bounds.bottom)} ${num(bounds.width)} ${num(bounds.height)} re`,
    'S',
  );

  if (caption) {
    ops.push(
      'BT',
      `/${DEFAULT_FONT_NAME} ${num(captionSize)} Tf`,
      '0.1 0.13 0.18 rg',
      // Baseline sits a third of the type size up from the band's floor, which
      // leaves room for descenders without the text drifting away from the
      // photo it belongs to.
      `${num(bounds.left + 2)} ${num(bounds.bottom - captionBand + captionSize * 0.55)} Td`,
      `(${escapeLiteral(truncate(caption, bounds.width, captionSize, font))}) Tj`,
      'ET',
    );
  }

  const resources = { Font: { [DEFAULT_FONT_NAME]: font.ref } };
  if (embedded) resources.XObject = { PLPhoto: embedded.ref };

  appendAnnotation(pdfDoc, page, {
    Type: 'Annot',
    Subtype: 'Stamp',
    Rect: rect,
    Name: 'Draft',
    ...markupFields({
      author,
      subject: 'Photo',
      createdAt: photo.createdAt,
      color: FRAME_RGB,
      contents: [
        caption || '(no caption)',
        embedded
          ? `Photo ${photo.media.width}x${photo.media.height}`
          : 'Photo unavailable — the image file could not be found on this device.',
      ].join('\n'),
    }),
    AP: { N: createAppearance(pdfDoc, rect, ops.join('\n'), resources) },
  });
});

/**
 * Embeds the blob, choosing the decoder from the recorded type.
 *
 * Returns null rather than throwing on a format pdf-lib rejects. The capture
 * path re-encodes everything to JPEG, so reaching this is a sign that media was
 * stored by something else — a future import, or a build from before the
 * processor existed — and a placeholder beats losing the export.
 */
async function embedImage(pdfDoc, blob, mimeType) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return mimeType === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  } catch (error) {
    console.warn('[punchlist] A photo could not be embedded and was drawn as a placeholder.', error);
    return null;
  }
}

/** Trims a caption to what fits the photo's width at the caption size. */
function truncate(value, widthPts, size, font) {
  const available = widthPts - 4;
  if (font.widthOfTextAtSize(value, size) <= available) return value;

  let clipped = value;
  while (clipped.length > 1 && font.widthOfTextAtSize(`${clipped}...`, size) > available) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}...`;
}

/**
 * Escapes a PDF literal string.
 *
 * The caption is drawn with `Tj` inside a content stream, where the bytes are
 * an operand rather than document text — so this is the `literal()` case from
 * pdfPrimitives, not the hex-encoded `text()` case. An unescaped bracket in a
 * user's caption would unbalance the stream and break the whole page.
 */
function escapeLiteral(value) {
  return value.replace(/[\\()]/g, (character) => `\\${character}`).replace(/[^\x20-\x7E]/g, '-');
}
