import { INK_KIND } from '../../../domain/annotations';
import { PdfWriterRegistry } from '../PdfWriterRegistry';
import { appendAnnotation, createAppearance, markupFields, num, paddedRect } from '../pdfPrimitives';

/**
 * Writes a freehand stroke as a native PDF `/Ink` annotation.
 *
 * The closest match in the whole export: `/InkList` is defined as an array of
 * paths, each a flat list of alternating x and y values in page coordinates —
 * which is byte-for-byte the shape `InkMarkup.serializePayload()` already
 * produces. Nothing is approximated or resampled in the round trip; the
 * exported stroke is exactly the points the finger drew.
 *
 * The appearance stream draws the same points as a polyline with rounded joins,
 * so the stroke looks smooth rather than faceted at the sample points.
 */
PdfWriterRegistry.register(INK_KIND, (markup, { pdfDoc, page, author }) => {
  const [r, g, b] = markup.style.toRgbFractions();
  const width = markup.style.strokeWidth;
  const rect = paddedRect(markup.getBounds(), width + 2);

  const ops = [
    `${num(r)} ${num(g)} ${num(b)} RG`,
    `${num(width)} w`,
    '1 J', // round line caps
    '1 j', // round line joins — without these a stroke looks chipped at samples
  ];

  markup.points.forEach((point, index) => {
    ops.push(`${num(point.x)} ${num(point.y)} ${index === 0 ? 'm' : 'l'}`);
  });
  ops.push('S');

  // One path per stroke. The nesting is required: /InkList is a list OF paths,
  // so a single stroke is still an array containing one array.
  const inkList = [markup.points.flatMap((point) => [point.x, point.y])];

  appendAnnotation(pdfDoc, page, {
    Type: 'Annot',
    Subtype: 'Ink',
    Rect: rect,
    InkList: inkList,
    ...markupFields({
      author,
      subject: 'Freehand markup',
      createdAt: markup.createdAt,
      color: [r, g, b],
      strokeWidth: width,
    }),
    AP: { N: createAppearance(pdfDoc, rect, ops.join('\n')) },
  });
});
