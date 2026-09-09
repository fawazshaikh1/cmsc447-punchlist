import { TEXT_KIND } from '../../../domain/annotations';
import { PdfWriterRegistry } from '../PdfWriterRegistry';
import { appendAnnotation, createAppearance, literal, markupFields, num, DEFAULT_FONT_NAME } from '../pdfPrimitives';

/**
 * Common typographic characters mapped to ASCII the base fonts can draw.
 *
 * These are what people actually paste in from a spec or get from a phone
 * keyboard's autocorrect, so handling them well is worth more than handling
 * the long tail.
 */
const TRANSLITERATIONS = [
  [/[‘’‚‛]/g, "'"],
  [/[“”„‟]/g, '"'],
  [/[–—―]/g, '-'],
  [/[…]/g, '...'],
  [/[   ]/g, ' '],
  [/[•]/g, '*'],
  [/[Ø∅]/g, 'dia.'],
];

/**
 * Makes a string safe to draw with a standard PDF font.
 *
 * =========================================================================
 * TWO SEPARATE ENCODING PROBLEMS — do not confuse them
 * =========================================================================
 * 1. `/Contents` on the annotation is a PDF text string, and carries full
 *    Unicode via `text()` in pdfPrimitives (UTF-16BE hex). Nothing is lost
 *    there — the comment panel in Acrobat shows exactly what the user typed.
 *
 * 2. The APPEARANCE STREAM below draws glyphs with embedded Helvetica, whose
 *    WinAnsi encoding simply has no glyph for most characters outside Latin-1.
 *    `font.widthOfTextAtSize` THROWS on them, so an unsanitised em-dash would
 *    not merely look wrong — it would abort the whole export with an opaque
 *    error, and the user would lose the file for one pasted character.
 *
 * So: transliterate what has an obvious ASCII equivalent, replace the rest with
 * '?', and let `/Contents` carry the true text. A user who needs real Unicode
 * on the page itself needs an embedded Unicode font, which is a deliberate
 * Sprint 3 decision (it adds ~300KB per export) and not something to do
 * silently here.
 */
function sanitizeForFont(value) {
  let out = value;
  for (const [pattern, replacement] of TRANSLITERATIONS) out = out.replace(pattern, replacement);
  // Anything still outside printable WinAnsi becomes '?' rather than throwing.
  return out.replace(/[^\x20-\x7E\xA1-\xFF]/g, '?');
}

/**
 * Escapes a string for use inside a PDF content-stream literal.
 *
 * Content-stream strings are delimited by parentheses, so an unescaped `)` in
 * user text terminates the string early and corrupts every operator after it —
 * turning a typo like "verify dim (typ)" into a broken page. Backslash must be
 * escaped first, or it would double-escape the escapes we then add.
 */
function escapeStreamText(value) {
  return sanitizeForFont(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Writes a text callout as a native PDF `/FreeText` annotation.
 *
 * The only writer needing a font resource: text can only be drawn in a content
 * stream via a font referenced from the form's `/Resources`. The exporter
 * embeds Helvetica once per document and passes it in, rather than embedding it
 * per annotation — a sheet with forty callouts would otherwise carry forty
 * copies of the same font.
 *
 * `/DA` (Default Appearance) repeats the font, size and colour in the syntax
 * Acrobat expects when the user edits the text. Without it, editing a callout
 * resets it to black 12pt Helvetica.
 */
PdfWriterRegistry.register(TEXT_KIND, (markup, { pdfDoc, page, author, font }) => {
  const { x, y } = markup.getAnchor();
  const [r, g, b] = markup.style.toRgbFractions();
  const bounds = markup.getBounds();
  const size = markup.fontSize;

  const rect = [bounds.x - 2, bounds.y - 2, bounds.x + bounds.width + 4, bounds.y + bounds.height + 2];

  const lines = markup.text.split('\n');
  const ops = ['BT', `/${DEFAULT_FONT_NAME} ${num(size)} Tf`, `${num(r)} ${num(g)} ${num(b)} rg`];

  lines.forEach((line, index) => {
    // Td is relative to the previous text position, so the first call moves to
    // the first baseline and each subsequent one steps down exactly one line.
    //
    // The first baseline sits ONE FONT SIZE BELOW the anchor, because the
    // anchor is the top-left of the text block (see TextMarkup.getBounds).
    // In PDF user space Y increases upward, so "below" is a subtraction. This
    // must match TextMarker's first `dy` exactly, or the exported callout sits
    // one line away from where the user placed it.
    if (index === 0) ops.push(`${num(x)} ${num(y - size)} Td`);
    else ops.push(`0 ${num(-size * 1.2)} Td`);
    ops.push(`(${escapeStreamText(line)}) Tj`);
  });

  ops.push('ET');

  appendAnnotation(pdfDoc, page, {
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: rect,
    ...markupFields({
      author,
      subject: 'Text markup',
      createdAt: markup.createdAt,
      contents: markup.text,
    }),
    // `/DA` (Default Appearance) is a CONTENT-STREAM OPERATOR string, not a
    // text string, so it must be a plain literal — `literal()`, never `text()`.
    //
    // BUG THIS FIXES: it was previously written as a UTF-16BE hex string, which
    // Acrobat cannot parse into drawing operators. The result was that text
    // callouts did not appear in Acrobat at all, while Chrome — which just uses
    // our `/AP` and ignores `/DA` — rendered them fine. That difference is why
    // it survived testing.
    DA: literal(`/${DEFAULT_FONT_NAME} ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`),
    // `/C` is the BACKGROUND colour for a FreeText. Omitted entirely rather
    // than written as an empty array, so the callout sits transparently over
    // the drawing instead of on an opaque panel.
    AP: {
      N: createAppearance(pdfDoc, rect, ops.join('\n'), { Font: { [DEFAULT_FONT_NAME]: font.ref } }),
    },
  });
});
