import { RECTANGLE_KIND } from '../../../domain/annotations';
import { PdfWriterRegistry } from '../PdfWriterRegistry';
import { appendAnnotation, createAppearance, markupFields, num, paddedRect } from '../pdfPrimitives';

/**
 * Writes a box markup as a native PDF `/Square` annotation.
 *
 * Acrobat shows it as a selectable, movable, commentable rectangle — not as
 * pixels burned into the page.
 *
 * The `/AP` appearance stream is mandatory here: Acrobat would synthesise one
 * from `/Rect` and `/BS`, but Chrome's viewer and several mobile viewers would
 * render nothing at all. See createAppearance for the full explanation.
 */
PdfWriterRegistry.register(RECTANGLE_KIND, (markup, { pdfDoc, page, author }) => {
  const bounds = markup.getBounds();
  const [r, g, b] = markup.style.toRgbFractions();
  const width = markup.style.strokeWidth;
  const rect = paddedRect(bounds, width);

  // Drawn in page coordinates, which works because BBox === Rect gives the form
  // an identity transform. Inset by half the stroke width so the stroke — which
  // straddles the path — lands exactly on the intended bounds.
  const half = width / 2;
  const contents = [
    `${num(r)} ${num(g)} ${num(b)} RG`,
    `${num(width)} w`,
    `${num(bounds.x + half)} ${num(bounds.y + half)} ` +
      `${num(bounds.width - width)} ${num(bounds.height - width)} re`,
    'S',
  ].join('\n');

  appendAnnotation(pdfDoc, page, {
    Type: 'Annot',
    Subtype: 'Square',
    Rect: rect,
    ...markupFields({
      author,
      subject: 'Markup',
      createdAt: markup.createdAt,
      color: [r, g, b],
      strokeWidth: width,
    }),
    // NOTE: `/IC` (interior colour) is deliberately OMITTED rather than written
    // as an empty array. Absent means "no fill", which is what we want — the
    // box must not hide the detail it is drawing attention to. An empty array
    // is legal but some viewers treat it inconsistently.
    AP: { N: createAppearance(pdfDoc, rect, contents) },
  });
});
