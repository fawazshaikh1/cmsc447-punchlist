import { ARROW_KIND } from '../../../domain/annotations';
import { PdfWriterRegistry } from '../PdfWriterRegistry';
import { appendAnnotation, createAppearance, markupFields, num } from '../pdfPrimitives';

/**
 * Writes an arrow as a native PDF `/Line` annotation with an arrowhead ending.
 *
 * `/L` carries the two endpoints and `/LE` declares the line endings — `/None`
 * at the tail, `/ClosedArrow` at the head. An editor that understands `/LE`
 * draws and maintains its own arrowhead, so the arrow stays editable.
 *
 * The `/AP` still draws the head explicitly, for viewers that ignore `/LE`.
 * The barb geometry comes from `ArrowMarkup.getHeadBarbs()` — the same method
 * the on-screen SVG marker uses — so the exported arrowhead is identical to
 * the one drawn during the walk rather than a second, subtly different
 * implementation.
 */
PdfWriterRegistry.register(ARROW_KIND, (markup, { pdfDoc, page, author }) => {
  const { start, end, style } = markup;
  const [r, g, b] = style.toRgbFractions();
  const width = style.strokeWidth;
  const barbs = markup.getHeadBarbs();

  // The rect must enclose the shaft AND both barbs, which can extend beyond
  // both endpoints depending on the arrow's direction.
  const xs = [start.x, end.x, barbs.left.x, barbs.right.x];
  const ys = [start.y, end.y, barbs.left.y, barbs.right.y];
  const pad = width + 2;
  const rect = [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];

  const contents = [
    `${num(r)} ${num(g)} ${num(b)} RG`,
    `${num(r)} ${num(g)} ${num(b)} rg`, // fill colour, for the solid head
    `${num(width)} w`,
    // Shaft
    `${num(start.x)} ${num(start.y)} m`,
    `${num(end.x)} ${num(end.y)} l`,
    'S',
    // Head: a filled triangle from the tip out to both barbs.
    `${num(end.x)} ${num(end.y)} m`,
    `${num(barbs.left.x)} ${num(barbs.left.y)} l`,
    `${num(barbs.right.x)} ${num(barbs.right.y)} l`,
    'h',
    'f',
  ].join('\n');

  appendAnnotation(pdfDoc, page, {
    Type: 'Annot',
    Subtype: 'Line',
    Rect: rect,
    L: [start.x, start.y, end.x, end.y],
    LE: ['None', 'ClosedArrow'],
    ...markupFields({
      author,
      subject: 'Markup',
      createdAt: markup.createdAt,
      color: [r, g, b],
      strokeWidth: width,
    }),
    // Interior colour fills the arrowhead for viewers that draw /LE themselves.
    // Unlike the box, a filled interior is exactly what an arrowhead wants.
    IC: [r, g, b],
    AP: { N: createAppearance(pdfDoc, rect, contents) },
  });
});
