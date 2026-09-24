import { PIN_KIND, PinStatus } from '../../../domain/annotations';
import { PdfWriterRegistry } from '../PdfWriterRegistry';
import { appendAnnotation, createAppearance, markupFields, num, DEFAULT_FONT_NAME } from '../pdfPrimitives';
import { pinLabelOps } from './pinLabelOps';

/** Pin radius in PDF points — matches PinMarker's on-screen radius. */
const RADIUS = 11;

/** Same colour language as the on-screen marker. */
const STATUS_RGB = {
  [PinStatus.OPEN]: [0.91, 0.20, 0.16],
  [PinStatus.READY_FOR_REVIEW]: [0.89, 0.59, 0.04],
  [PinStatus.CLOSED]: [0.12, 0.62, 0.30],
};

/**
 * How a status reads on the label drawn beside the pin.
 *
 * Short, because it sits on a drawing. The schedule spells it out in full; here
 * the job is to answer "is this done?" at a glance while standing in the room.
 */
const STATUS_TAG = {
  [PinStatus.OPEN]: 'OPEN',
  [PinStatus.READY_FOR_REVIEW]: 'READY FOR REVIEW',
  [PinStatus.CLOSED]: 'CLOSED',
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
PdfWriterRegistry.register(PIN_KIND, (pin, { pdfDoc, page, author, font, index, ordinal }) => {
  const { x, y } = pin.getAnchor();
  const rgb = STATUS_RGB[pin.status] ?? STATUS_RGB[PinStatus.OPEN];

  // The number a person uses to refer to this item: its position among PINS,
  // across the whole set. It is also the number printed on the schedule, which
  // is the only reason the schedule is usable — see assignOrdinals.
  //
  // `index` is the fallback for a caller that does not number: it counts every
  // markup on the sheet, so a pin drawn after two boxes came out as "3". That
  // was the behaviour, and it is why this argument exists.
  const label = String(ordinal ?? index + 1);
  const fontSize = RADIUS;
  const labelWidth = font.widthOfTextAtSize(label, fontSize);

  // ==========================================================================
  // THE DESCRIPTION, DRAWN ON THE DRAWING
  // ==========================================================================
  // A pin used to carry its description only in `/Contents`, which a viewer
  // shows on hover. That is invisible on paper and gone entirely once the file
  // is flattened, so an issued sheet showed a numbered circle and nothing to
  // say what the item was — or whether it had been done.
  //
  // Reported as: "i need the pin description to show, or else how would we know
  // if that thing is done or verified after completion".
  //
  // The layout comes from the domain, shared with the on-screen marker, so the
  // export and the canvas show the same box in the same place.
  const descriptionBox = pinLabelOps({
    x,
    y,
    description: pin.label,
    status: STATUS_TAG[pin.status] ?? pin.status,
    rgb,
    font,
  });

  // The rectangle has to contain everything the appearance draws. An annotation
  // whose /Rect is smaller than its artwork is clipped by some viewers and
  // mispositioned by the flattener, which maps the appearance's BBox onto it.
  const rect = [
    Math.min(x - RADIUS - 2, descriptionBox.bounds.left),
    Math.min(y - RADIUS - 2, descriptionBox.bounds.bottom),
    Math.max(x + RADIUS + 2, descriptionBox.bounds.right),
    Math.max(y + RADIUS + 2, descriptionBox.bounds.top),
  ];

  const ops = [
    // Label first, so the pin sits ON TOP of the leader line rather than
    // having it run across the disc.
    ...descriptionBox.ops,
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
