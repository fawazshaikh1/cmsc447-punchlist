/**
 * Where a pin's description sits on the sheet, and how it wraps.
 *
 * ===========================================================================
 * WHY THIS IS SHARED GEOMETRY AND NOT TWO IMPLEMENTATIONS
 * ===========================================================================
 * The same label has to be drawn twice: once as SVG on the canvas, once as
 * content-stream operators inside the exported PDF. The promise the product
 * makes is that those two are the SAME PICTURE — a promise already broken once,
 * by a cloud that was rendered from different code on each side and drifted.
 *
 * So the rule lives here, once, and both renderers ask it where things go. They
 * differ only in how they paint, never in what they paint or where.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE USING THE NUMBERS: Y IS UP
 * ---------------------------------------------------------------------------
 * Everything returned is in PDF user space, relative to the pin's centre, with
 * **Y increasing upwards**. That matches the PDF writer directly. The SVG
 * overlay works in the same units with the Y axis FLIPPED, so it must negate
 * every Y it takes from here.
 *
 * This is stated so loudly because getting it wrong is invisible on screen and
 * wrong in the export — which is exactly how the cloud bug survived review. A
 * check in verify-pin-label.mjs asserts the first line sits above the last, so
 * a sign error fails there rather than in someone's hands.
 */

/** Pin radius, in PDF points. Must match PinMarker and pinWriter. */
export const PIN_RADIUS = 11;

/**
 * Every dimension of the label, in PDF points.
 *
 * Points rather than pixels because a markup belongs to the SHEET: it scales
 * with the drawing as the user zooms, and prints at a fixed size relative to
 * the linework, which is how a physical markup behaves.
 */
export const PIN_LABEL = Object.freeze({
  /** Clear space between the pin's edge and the label box. */
  gap: 7,
  /** The box never grows wider than this, however long the description. */
  maxWidth: 240,
  padding: 6,
  fontSize: 9,
  lineHeight: 11.5,
  /**
   * Descriptions run long. Three lines is enough for a real instruction and
   * short enough that a sheet with a dozen items is still a drawing rather than
   * a wall of text; the rest is on the schedule.
   */
  maxLines: 3,
  /** Gap between the last description line and the status tag. */
  statusGap: 3,
  statusSize: 7,
  cornerRadius: 3,
  borderWidth: 1,
});

/** What the box says when nobody has written the item up yet. */
export const NO_DESCRIPTION = '(no description)';

/**
 * Lays out one pin's label.
 *
 * @param {object} request
 * @param {string} request.description
 * @param {string} request.status A short tag, e.g. "OPEN". Drawn uppercase.
 * @param {(text: string, size: number) => number} request.measure
 *        Returns the width of `text` at `size`, in points. Injected because the
 *        two renderers measure with different machinery — pdf-lib's embedded
 *        font metrics, and the browser's canvas — and neither belongs in the
 *        domain. Both are asked for Helvetica, so they agree in practice.
 * @returns {{
 *   lines: string[],
 *   statusText: string,
 *   box: { left: number, right: number, top: number, bottom: number,
 *          width: number, height: number },
 *   textLeft: number,
 *   lineBaselines: number[],
 *   statusBaseline: number,
 * }} All coordinates relative to the pin's centre, Y UP.
 */
export function layoutPinLabel({ description, status, measure }) {
  const text = toDrawable(description).trim() || NO_DESCRIPTION;
  const statusText = toDrawable(status).trim().toUpperCase();

  const innerMax = PIN_LABEL.maxWidth - PIN_LABEL.padding * 2;
  const lines = wrapToLines(text, innerMax, PIN_LABEL.fontSize, measure, PIN_LABEL.maxLines);

  // The box hugs its content rather than always being maxWidth, so a two-word
  // item does not sit inside a banner four times its length.
  const widest = Math.max(
    ...lines.map((line) => measure(line, PIN_LABEL.fontSize)),
    statusText ? measure(statusText, PIN_LABEL.statusSize) : 0,
  );
  const width = Math.min(PIN_LABEL.maxWidth, widest + PIN_LABEL.padding * 2);

  const textHeight =
    lines.length * PIN_LABEL.lineHeight +
    (statusText ? PIN_LABEL.statusGap + PIN_LABEL.statusSize : 0);
  const height = textHeight + PIN_LABEL.padding * 2;

  const left = PIN_RADIUS + PIN_LABEL.gap;
  // Centred on the pin vertically, so the label reads as attached to it rather
  // than as a separate note that happens to be nearby.
  const top = height / 2;

  const textLeft = left + PIN_LABEL.padding;

  // First line's baseline sits one line-height below the box's inner top. Each
  // subsequent line is LOWER, so these DECREASE — Y is up.
  const lineBaselines = lines.map(
    (_, index) =>
      top - PIN_LABEL.padding - PIN_LABEL.fontSize - index * PIN_LABEL.lineHeight,
  );

  const statusBaseline = statusText
    ? top - PIN_LABEL.padding - textHeight + PIN_LABEL.statusSize * 0.15
    : 0;

  return {
    lines,
    statusText,
    box: { left, right: left + width, top, bottom: -top, width, height },
    textLeft,
    lineBaselines,
    statusBaseline,
  };
}

/**
 * Folds a description to characters the label can actually draw.
 *
 * ===========================================================================
 * WHY THIS IS HERE, IN THE DOMAIN, AND NOT IN THE PDF WRITER
 * ===========================================================================
 * It looks like an encoding detail that belongs next to the PDF operators, and
 * putting it there was a bug caught by verify-punchlist:
 *
 *   1. A standard PDF font is WinAnsi-only, and pdf-lib's `widthOfTextAtSize`
 *      THROWS on a character outside it. So measuring an unsanitized
 *      description did not produce a bad label — it failed the entire export,
 *      over one emoji somebody pasted into a punch item.
 *
 *   2. Sanitizing on the PDF side alone would leave the canvas measuring a
 *      DIFFERENT string: the two would wrap at different words and print
 *      different characters, which is precisely the drift this whole module
 *      exists to prevent.
 *
 * So it happens once, before anything is measured, and both renderers work from
 * the identical text. What a markup can DRAW is a product constraint, not a
 * file-format one — the canvas is bound by it just as much, because the canvas
 * has to show what the export will contain.
 *
 * Accented Latin survives: WinAnsi covers U+00A0–U+00FF, so a name or a
 * material with a diacritic is drawn properly rather than mangled.
 */
function toDrawable(value) {
  return String(value ?? '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, '?');
}

/**
 * Greedy wrap against real measured widths, truncating past `maxLines`.
 *
 * Measured rather than estimated from character count, because that guess is
 * wrong by a factor of two between "IIII" and "mmmm" and the failure mode is
 * text running out of its own box across the drawing.
 *
 * The overflow marker is three full stops, NOT a U+2026 ellipsis: the PDF
 * writer composes raw content-stream operators and escapes them to ASCII, so a
 * real ellipsis would survive on the canvas and vanish in the export — leaving
 * the two renderers disagreeing about the one glyph whose whole job is to say
 * "there is more text than this".
 *
 * Either way the marker has to be visible. A description silently cut at three
 * lines reads as a complete instruction, and a complete-looking instruction
 * missing its last clause is worse on a construction site than an obviously
 * truncated one.
 */
function wrapToLines(value, maxWidth, size, measure, maxLines) {
  const words = String(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [NO_DESCRIPTION];

  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (measure(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);
    line = word;

    // One more than the cap, so there is something to mark as truncated.
    if (lines.length > maxLines) break;
  }

  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(kept[maxLines - 1], maxWidth, size, measure);
  return kept;
}

/** Trims a line until it plus an ellipsis fits. */
function ellipsize(line, maxWidth, size, measure) {
  let clipped = line;
  while (clipped.length > 1 && measure(`${clipped}...`, size) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trimEnd()}...`;
}
