import { num, DEFAULT_FONT_NAME } from '../pdfPrimitives';
import { PIN_LABEL, layoutPinLabel } from '../../../domain/annotations/geometry/pinLabel';

/**
 * Content-stream operators for the description box beside a pin.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE FILE FROM pinWriter
 * ===========================================================================
 * pinWriter draws the pin: a disc, a ring, a number. That is one idea and it
 * was complete. This is a second idea — what the pin SAYS — with its own
 * wrapping, its own box, its own colour rules and its own reasons to change.
 *
 * Splitting them means the decision "how much of a description do we show"
 * can be revisited without reopening the file that knows how to draw a circle,
 * and that a future markup type wanting the same treatment can call this
 * directly instead of copying it out of pinWriter.
 *
 * ---------------------------------------------------------------------------
 * THE POSITIONS COME FROM THE DOMAIN, NOT FROM HERE
 * ---------------------------------------------------------------------------
 * Every coordinate below is read from `layoutPinLabel`, which the on-screen
 * marker also reads. Nothing here decides WHERE anything goes — only how to
 * paint it once told. That is what keeps the canvas and the export showing the
 * same picture rather than two drawings that happen to agree today.
 */

/**
 * @param {object} request
 * @param {number} request.x Pin centre, PDF user space.
 * @param {number} request.y
 * @param {string} request.description
 * @param {string} request.status Short tag, e.g. "OPEN".
 * @param {[number, number, number]} request.rgb Status colour.
 * @param {object} request.font Embedded font, for measuring.
 * @returns {{ ops: string[], bounds: { left: number, bottom: number, right: number, top: number } }}
 *          Operators to append, and the area they cover in page coordinates so
 *          the caller can grow the annotation's `/Rect` to contain them.
 */
export function pinLabelOps({ x, y, description, status, rgb, font }) {
  const layout = layoutPinLabel({
    description,
    status,
    measure: (text, size) => font.widthOfTextAtSize(text, size),
  });

  const { box } = layout;
  const left = x + box.left;
  const bottom = y + box.bottom;

  const ops = [
    // White backing first. Without it the description sits directly on top of
    // whatever linework happens to be underneath, and a dimension string
    // running through a sentence makes both unreadable.
    '1 1 1 rg',
    `${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} RG`,
    `${num(PIN_LABEL.borderWidth)} w`,
    ...roundedRectPath(left, bottom, box.width, box.height, PIN_LABEL.cornerRadius),
    // Fill AND stroke in one operation, so the border cannot end up offset from
    // the fill by a rounding difference between two separate paths.
    'B',

    // A short leader from the pin to the box. Two pins close together produce
    // two boxes, and the leader is what says which one belongs to which.
    `${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} RG`,
    `${num(PIN_LABEL.borderWidth)} w`,
    `${num(x + box.left - PIN_LABEL.gap)} ${num(y)} m`,
    `${num(left)} ${num(y)} l`,
    'S',
  ];

  ops.push('BT', `/${DEFAULT_FONT_NAME} ${num(PIN_LABEL.fontSize)} Tf`, '0.1 0.13 0.18 rg');
  for (let index = 0; index < layout.lines.length; index++) {
    // Each line is positioned absolutely rather than with `TL`/`T*` leading,
    // because the baselines come from the domain and must not be re-derived
    // here — re-deriving them is how the canvas and the export drift apart.
    ops.push(
      '1 0 0 1 0 0 Tm',
      `${num(x + layout.textLeft)} ${num(y + layout.lineBaselines[index])} Td`,
      `(${escapeLiteral(layout.lines[index])}) Tj`,
    );
  }
  ops.push('ET');

  if (layout.statusText) {
    ops.push(
      'BT',
      `/${DEFAULT_FONT_NAME} ${num(PIN_LABEL.statusSize)} Tf`,
      `${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} rg`,
      `${num(x + layout.textLeft)} ${num(y + layout.statusBaseline)} Td`,
      `(${escapeLiteral(layout.statusText)}) Tj`,
      'ET',
    );
  }

  return {
    ops,
    bounds: {
      left,
      bottom,
      right: x + box.right,
      top: y + box.top,
    },
  };
}

/**
 * A rounded rectangle as a closed path.
 *
 * PDF has no rectangle-with-corners operator, so the four arcs are cubic
 * Béziers. KAPPA is the standard constant for approximating a quarter circle;
 * at these radii the error is far below a printer's dot.
 */
const KAPPA = 0.5522847498;

function roundedRectPath(x, y, width, height, radius) {
  // A radius larger than half the shorter side would make the curves cross
  // themselves and produce a bow-tie.
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const k = KAPPA * r;
  const right = x + width;
  const top = y + height;

  return [
    `${num(x + r)} ${num(y)} m`,
    `${num(right - r)} ${num(y)} l`,
    `${num(right - r + k)} ${num(y)} ${num(right)} ${num(y + r - k)} ${num(right)} ${num(y + r)} c`,
    `${num(right)} ${num(top - r)} l`,
    `${num(right)} ${num(top - r + k)} ${num(right - r + k)} ${num(top)} ${num(right - r)} ${num(top)} c`,
    `${num(x + r)} ${num(top)} l`,
    `${num(x + r - k)} ${num(top)} ${num(x)} ${num(top - r + k)} ${num(x)} ${num(top - r)} c`,
    `${num(x)} ${num(y + r)} l`,
    `${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c`,
    'h',
  ];
}

/**
 * Escapes a PDF literal string.
 *
 * The text is drawn with `Tj` inside a content stream, where the bytes are an
 * operand rather than document text — so this is the `literal()` case from
 * pdfPrimitives, not the hex-encoded `text()` case. An unescaped bracket in a
 * user's description would unbalance the stream and break the whole page.
 */
function escapeLiteral(value) {
  return String(value)
    .replace(/[\\()]/g, (character) => `\\${character}`)
    .replace(/[^\x20-\x7E]/g, '-');
}
