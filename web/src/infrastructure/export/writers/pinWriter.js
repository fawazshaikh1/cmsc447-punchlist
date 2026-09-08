import { PIN_KIND, PinStatus } from '../../../domain/annotations';
import { PdfWriterRegistry } from '../PdfWriterRegistry';
import { appendAnnotation, createAppearance, markupFields, num, DEFAULT_FONT_NAME } from '../pdfPrimitives';

/** Pin radius in PDF points — matches PinMarker's on-screen radius. */
const RADIUS = 11;

/** Same colour language as the on-screen marker. */
const STATUS_RGB = {
  [PinStatus.OPEN]: [0.91, 0.20, 0.16],
  [PinStatus.READY_FOR_REVIEW]: [0.89, 0.59, 0.04],
  [PinStatus.CLOSED]: [0.12, 0.62, 0.30],
};

/** Bézier constant for approximating a quarter circle: 4/3 * tan(PI/8). */
const KAPPA = 0.5522847498;

/**
 * Content-stream operators drawing a filled circle with a stroked ring.
 * PDF has no circle operator, so it is four cubic Béziers.
 */
function circlePath(cx, cy, r) {
  const k = KAPPA * r;
  return [
    `${num(cx + r)} ${num(cy)} m`,
    `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c`,
    `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c`,
    `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c`,
    `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c`,
    'h',
  ];
}

/**
 * Writes a punch-item pin as a native PDF `/Stamp` annotation carrying our own
 * numbered-circle appearance.
 *
 * ===========================================================================
 * WHY NOT `/Text` — the bug this replaces
 * ===========================================================================
 * The first version used a `/Text` annotation, which is the classic PDF sticky
 * note. It was correct by the specification but wrong in practice: a `/Text`
 * annotation's icon is drawn by the VIEWER from its `/Name` entry, so the
 * numbered red pins placed during a walk came out as generic yellow speech
 * bubbles in Acrobat and Chrome. The reviewer could not tell pin 3 from pin 11,
 * and nothing on the page matched what the field user had actually seen.
 *
 * `/Stamp` is the annotation type designed for "custom appearance plus a
 * comment". It carries our own appearance stream — so the export shows the same
 * numbered red circle as the app — while still being a real markup annotation:
 * it appears in Acrobat's Comments panel, it holds `/Contents`, and it can be
 * selected, moved, replied to and marked resolved by the architect.
 *
 * The lesson worth keeping: "correct per the spec" and "shows the user what
 * they drew" are different bars, and only the second one matters at a demo.
 */
PdfWriterRegistry.register(PIN_KIND, (pin, { pdfDoc, page, author, font, index }) => {
  const { x, y } = pin.getAnchor();
  const rgb = STATUS_RGB[pin.status] ?? STATUS_RGB[PinStatus.OPEN];

  // 1-based number, matching the ordinal shown in the app and the inspector.
  const label = String(index + 1);
  const fontSize = RADIUS;
  const labelWidth = font.widthOfTextAtSize(label, fontSize);

  const rect = [x - RADIUS - 2, y - RADIUS - 2, x + RADIUS + 2, y + RADIUS + 2];

  const ops = [
    // Filled disc in the status colour.
    `${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} rg`,
    ...circlePath(x, y, RADIUS),
    'f',
    // White ring, so the pin stays visible over dark linework.
    '1 1 1 RG',
    '2 w',
    ...circlePath(x, y, RADIUS),
    'S',
    // White number, centred. Horizontally by measured width; vertically by
    // roughly a third of the cap height, which optically centres digits.
    'BT',
    `/${DEFAULT_FONT_NAME} ${num(fontSize)} Tf`,
    '1 1 1 rg',
    `${num(x - labelWidth / 2)} ${num(y - fontSize * 0.34)} Td`,
    `(${label}) Tj`,
    'ET',
  ];

  appendAnnotation(pdfDoc, page, {
    Type: 'Annot',
    Subtype: 'Stamp',
    Rect: rect,
    // `/Name` is required by the spec for a Stamp. Viewers ignore it when an
    // appearance stream is present, but omitting it makes some validators
    // complain, and a malformed annotation is not worth the two bytes saved.
    Name: 'Draft',
    ...markupFields({
      author,
      subject: 'Punch item',
      createdAt: pin.createdAt,
      color: rgb,
      contents: [
        `Punch item ${label} — ${pin.status.replace(/_/g, ' ')}`,
        pin.label || '(no description)',
        `Created ${pin.createdAt.toISOString().slice(0, 10)}`,
      ].join('\n'),
    }),
    AP: { N: createAppearance(pdfDoc, rect, ops.join('\n'), { Font: { [DEFAULT_FONT_NAME]: font.ref } }) },
  });
});
