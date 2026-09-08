import { PDFName, PDFArray, PDFDict, PDFHexString, PDFString } from 'pdf-lib';

/**
 * Low-level helpers for writing PDF annotation objects.
 *
 * Everything here deals in raw PDF dictionary structure rather than pdf-lib's
 * high-level drawing API, because pdf-lib's `drawRectangle` and friends paint
 * into the page CONTENT STREAM — which would modify the drawing itself. We must
 * only ever append to `/Annots`, so the original sheet comes out byte-identical.
 * That constraint is the whole reason this file exists.
 */

/**
 * PDF date string: `D:YYYYMMDDHHmmSSZ`.
 *
 * =========================================================================
 * BUG THIS FIXES — malformed dates on every annotation we wrote
 * =========================================================================
 * The previous version derived the date from `toISOString()` by stripping
 * dashes and colons, which left the ISO **`T` separator** in place:
 *
 *     produced  D:20260907T234408Z      <- not a legal PDF date
 *     required  D:20260907234408Z
 *
 * PDF dates have no `T`. Acrobat validates `/M` and `/CreationDate` on markup
 * annotations far more strictly than Chrome does, and a comment whose date it
 * cannot parse is a comment it may decline to display or manage.
 *
 * Built from UTC components rather than by string surgery, so there is no
 * separator left to forget.
 */
export function pdfDate(date) {
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return (
    'D:' +
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

/** Decimal places kept in everything we write. See `roundNumbers`. */
const PRECISION = 3;

/** Formats a number for a content stream. PDF has no exponent notation. */
export function num(value) {
  return Number(value).toFixed(PRECISION);
}

/**
 * Recursively rounds every number in a plain object or array.
 *
 * =========================================================================
 * WHY THIS EXISTS — the bug that hid drawings from Acrobat
 * =========================================================================
 * Content-stream operators went through `num()` and were rounded to three
 * decimals. Values written into the annotation DICTIONARY did not, so they
 * carried full IEEE-754 expansions straight from the geometry:
 *
 *     /InkList [ [ 300 292 308 303.82013258009624 ... ] ]
 *     /Rect [ 596 283.1148010562058 724 340.97387292744816 ]
 *
 * Adobe's implementation limit for a PDF real number is about five significant
 * decimal digits. Beyond that the value is out of range, and Acrobat's response
 * is to reject the object rather than round it — so the annotation simply never
 * appeared. Chrome's parser is lenient and rendered it fine, which is exactly
 * why this survived every test we ran.
 *
 * It also explains the pattern that made no sense at first: boxes worked and
 * freehand strokes did not. A box dragged between two clamped points tends to
 * land on integers. A freehand stroke, sampled through a scale transform, never
 * does.
 *
 * Three decimals is 1/1000 of a point — about a third of a micron on paper.
 * Nothing measurable is lost.
 *
 * Applied inside `appendAnnotation` and `createAppearance`, so it is a single
 * choke point that no writer can forget to use.
 */
export function roundNumbers(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(PRECISION)) : 0;
  }
  if (Array.isArray(value)) return value.map(roundNumbers);
  // Only plain objects are walked. PDF-lib objects (PDFHexString, PDFString,
  // references) must pass through untouched or they would be destroyed.
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundNumbers(v)]));
  }
  return value;
}

/**
 * Appends an annotation dictionary to a page's `/Annots` array.
 *
 * Creates the array if the page has none — a page with no existing annotations
 * simply has no `/Annots` entry, which is legal and common.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {object} page A pdf-lib PDFPage.
 * @param {object} dict Plain object describing the annotation.
 * @returns {object} The registered reference.
 */
export function appendAnnotation(pdfDoc, page, dict) {
  // Rounded here so every writer benefits without having to remember. See
  // roundNumbers for why full-precision values made annotations vanish.
  const ref = pdfDoc.context.register(pdfDoc.context.obj(roundNumbers(dict)));

  let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) {
    annots = pdfDoc.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(ref);

  return ref;
}

/**
 * Builds an appearance stream (`/AP /N`) for an annotation.
 *
 * =========================================================================
 * WHY EVERY SHAPE ANNOTATION MUST HAVE ONE
 * =========================================================================
 * The PDF spec lets a viewer synthesise an appearance for Square, Circle,
 * Polygon and Line annotations from their geometry entries. **Acrobat does
 * this. Chrome's built-in viewer and several mobile viewers do not.**
 *
 * The failure mode is the worst kind: you test in Acrobat, everything looks
 * perfect, you ship — and on the iPad the markups render as absolutely nothing,
 * with no error anywhere. Supplying `/AP` removes the viewer's discretion.
 *
 * ---------------------------------------------------------------------------
 * THE BBox TRICK
 * ---------------------------------------------------------------------------
 * A form XObject's `/BBox` is mapped onto the annotation's `/Rect`. By setting
 * BBox EQUAL to Rect we get an identity mapping, which means the content stream
 * can be written directly in PAGE coordinates — the same PDF user space our
 * PdfPoints are already in. No translation maths, and therefore no opportunity
 * to get the translation wrong.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {[number, number, number, number]} rect [x0, y0, x1, y1] in page space.
 * @param {string} contents The content stream operators.
 * @param {object} [resources] e.g. `{ Font: { F1: fontRef } }` for text.
 * @returns {object} A reference to the form XObject.
 */
export function createAppearance(pdfDoc, rect, contents, resources = {}) {
  const stream = pdfDoc.context.stream(contents, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    // Must be rounded identically to the annotation's /Rect. The two are
    // mapped onto each other, so a mismatch in the last decimal place would
    // introduce a sub-pixel scale into every appearance stream.
    BBox: roundNumbers(rect),
    Resources: pdfDoc.context.obj(resources),
  });

  return pdfDoc.context.register(stream);
}

/**
 * The `/Rect` for a bounds box, padded so strokes are not clipped.
 *
 * A stroke straddles its path — half its width falls outside. Without padding,
 * a 2pt border on a rectangle would be shaved along every edge by viewers that
 * clip to `/Rect`, which reads as a subtly thin or broken outline.
 *
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {number} padding Usually the stroke width.
 * @returns {[number, number, number, number]}
 */
export function paddedRect(bounds, padding) {
  return [
    bounds.x - padding,
    bounds.y - padding,
    bounds.x + bounds.width + padding,
    bounds.y + bounds.height + padding,
  ];
}

/**
 * Wraps a JS string as a PDF text string.
 *
 * =========================================================================
 * WHY HEX (UTF-16BE) AND NOT A PLAIN LITERAL STRING
 * =========================================================================
 * BUG THIS FIXES, found by inspecting a real export: `PDFString.of()` writes a
 * literal `(...)` string, which is a BYTE string. Any character above U+00FF is
 * silently truncated to its low byte — an em-dash (U+2014) came out as 0x14, a
 * device-control character. It does not throw and the file still opens; the
 * text is just quietly wrong.
 *
 * That is not an edge case for this product. Punch item descriptions are typed
 * by people on site: "café", "Ø 50mm", "—", curly quotes pasted from a spec,
 * names with accents. All of them would be corrupted in the file handed to the
 * client.
 *
 * `PDFHexString.fromText()` writes UTF-16BE with a byte-order mark, which is
 * the PDF specification's way of carrying arbitrary Unicode in a text string
 * and is understood by every viewer.
 *
 * NOTE: this applies to text STRINGS in annotation dictionaries (`/Contents`,
 * `/T`, `/Subj`). Text drawn inside an appearance stream is a different
 * problem — it is limited by the embedded font's glyph set, and Helvetica's
 * WinAnsi encoding genuinely cannot render most non-Latin characters. See
 * textWriter for how that is handled.
 */
export function text(value) {
  return PDFHexString.fromText(String(value));
}

/** The font name used in `/DA` and in every appearance stream's resources. */
export const DEFAULT_FONT_NAME = 'Helv';

/**
 * Registers the export font in the document's AcroForm default resources.
 *
 * =========================================================================
 * WHY — the second bug that hid text callouts from Acrobat
 * =========================================================================
 * A `/FreeText` annotation's `/DA` names a font: `(/Helv 12 Tf ...)`. That name
 * is NOT resolved against the annotation's own appearance-stream resources. It
 * is resolved against the document's **AcroForm `/DR /Font`** dictionary.
 *
 * We were writing `/DA (/Helv ...)` into a document with no AcroForm at all,
 * while the appearance stream called the very same font `/F1`. So `/Helv`
 * resolved to nothing. Acrobat regenerates FreeText appearances rather than
 * trusting a supplied `/AP`; that regeneration needs the `/DA` font, and with
 * no font it produced nothing — the callout vanished.
 *
 * Chrome renders our `/AP` directly and never looks at `/DA`, which is why the
 * text was visible there the whole time.
 *
 * The fix needs both halves: the `/DR` entry created here, AND the appearance
 * stream naming its font `/Helv` too, so the two agree. Hence DEFAULT_FONT_NAME
 * being used in both places rather than a literal in each.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {object} font An embedded pdf-lib PDFFont.
 */
export function ensureDefaultFontResource(pdfDoc, font) {
  const catalog = pdfDoc.catalog;

  let acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acroForm) {
    // `/Fields` is required and may legitimately be empty. We are borrowing the
    // AcroForm purely as the place the spec says default resources live — not
    // adding form fields to somebody's drawing set.
    acroForm = pdfDoc.context.obj({ Fields: [] });
    catalog.set(PDFName.of('AcroForm'), acroForm);
  }

  let dr = acroForm.lookupMaybe(PDFName.of('DR'), PDFDict);
  if (!dr) {
    dr = pdfDoc.context.obj({});
    acroForm.set(PDFName.of('DR'), dr);
  }

  let fonts = dr.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) {
    fonts = pdfDoc.context.obj({});
    dr.set(PDFName.of('Font'), fonts);
  }

  // Never overwrite a font the source document already declares under this
  // name — that would change how its own existing form fields render.
  if (!fonts.get(PDFName.of(DEFAULT_FONT_NAME))) {
    fonts.set(PDFName.of(DEFAULT_FONT_NAME), font.ref);
  }
}

/**
 * Wraps a value as a PLAIN literal `(...)` string — ASCII, never hex.
 *
 * =========================================================================
 * WHY BOTH THIS AND `text()` EXIST — the distinction that broke Acrobat
 * =========================================================================
 * Not every PDF string is a "text string". Three kinds appear in an annotation
 * dictionary and they are not interchangeable:
 *
 *   TEXT strings    /Contents, /T, /Subj  — human language, may be any
 *                   Unicode. Use `text()` (UTF-16BE hex).
 *
 *   DATE strings    /M, /CreationDate     — a fixed ASCII grammar.
 *   OPERATOR strings /DA                  — content-stream operators, parsed
 *                   as code by the viewer.
 *
 * The last two MUST be literal ASCII. Encoding them as UTF-16BE hex — which is
 * what a blanket `text()` did — produced a `/DA` Acrobat could not parse into
 * drawing operators and a `/M` it could not parse as a date. Chrome tolerated
 * both; Acrobat did not, and the text callouts simply did not appear.
 *
 * The lesson: "make everything Unicode-safe" was the right instinct applied one
 * level too broadly.
 */
export function literal(value) {
  return PDFString.of(String(value));
}

let annotationCounter = 0;

/**
 * The entries every markup annotation shares.
 *
 * Collected here rather than repeated in six writers so that a conformance fix
 * — like the date format above — is made once and applies to every annotation
 * type. Repeating them was how three of the six ended up subtly different.
 *
 * @param {object} spec
 * @param {string} spec.author
 * @param {string} spec.subject   Shown as the comment category in Acrobat.
 * @param {Date}   spec.createdAt
 * @param {string} [spec.contents]
 * @param {[number,number,number]} [spec.color] Omitted entirely when absent —
 *        an empty `/C []` is legal but Acrobat handles a missing key better.
 * @param {number} [spec.strokeWidth]
 */
export function markupFields({ author, subject, createdAt, contents, color, strokeWidth }) {
  const when = literal(pdfDate(createdAt));

  const fields = {
    T: text(author),
    Subj: text(subject),
    // Both dates are supplied. Acrobat's Comments panel sorts and groups by
    // /CreationDate, and an annotation without one can be filtered out of the
    // list even when it draws correctly on the page.
    M: when,
    CreationDate: when,
    // A stable unique name. Acrobat uses /NM to identify an annotation across
    // edits; without one, replies and status changes can be lost on save.
    NM: literal(`punchlist-${Date.now().toString(36)}-${(annotationCounter++).toString(36)}`),
    // Bit 3 (value 4) is Print. Without it the markup shows on screen but
    // vanishes from printouts — and punch lists get printed.
    F: 4,
    CA: 1,
  };

  if (contents !== undefined) fields.Contents = text(contents);
  if (color) fields.C = color;
  if (strokeWidth) fields.BS = { W: strokeWidth, S: 'S' };

  return fields;
}
