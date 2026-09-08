import { CLOUD_KIND } from '../../../domain/annotations';
import { scallopArcs, arcToBeziers } from '../../../domain/annotations/geometry/scallops';
import { PdfWriterRegistry } from '../PdfWriterRegistry';
import { appendAnnotation, createAppearance, markupFields, num, paddedRect } from '../pdfPrimitives';

/**
 * Writes a revision cloud as a native PDF `/Polygon` annotation with a cloudy
 * border effect.
 *
 * ---------------------------------------------------------------------------
 * TWO MECHANISMS, DELIBERATELY BOTH
 * ---------------------------------------------------------------------------
 * 1. `/BE << /S /C /I 2 >>` — Border Effect, Style Cloudy, Intensity 2. This is
 *    the PDF specification's own revision-cloud feature. Acrobat and other
 *    full editors understand it, and crucially it means the exported cloud is
 *    an EDITABLE cloud: the architect can drag its corners and it re-scallops
 *    itself, exactly as one drawn in Bluebeam or Acrobat would.
 *
 * 2. `/AP` — our own scalloped path. Viewers that ignore `/BE` (Chrome, most
 *    mobile viewers) fall back to the appearance stream and still see a proper
 *    cloud rather than a plain polygon or nothing.
 *
 * Supplying both means the markup is correct everywhere and remains editable
 * where editing is possible. The scallop geometry comes from the shared
 * `scallops` module, so this cloud and the on-screen SVG cloud are guaranteed
 * to be the same shape.
 */
PdfWriterRegistry.register(CLOUD_KIND, (markup, { pdfDoc, page, author }) => {
  const bounds = markup.getBounds();
  const [r, g, b] = markup.style.toRgbFractions();
  const width = markup.style.strokeWidth;
  const arcs = scallopArcs(bounds, markup.getArcRadius());

  // Padding accounts for the stroke AND for the scallops, which bulge a full
  // radius beyond the rectangle. Without the radius the bumps would be clipped.
  const rect = paddedRect(bounds, width + (arcs[0]?.r ?? 0) + 2);

  const ops = [`${num(r)} ${num(g)} ${num(b)} RG`, `${num(width)} w`];

  arcs.forEach((arc, index) => {
    const { start, curves } = arcToBeziers(arc);
    // Each scallop starts where the previous ended, so only the first needs an
    // explicit moveto; the rest continue the same path and join cleanly.
    if (index === 0) ops.push(`${num(start.x)} ${num(start.y)} m`);
    else ops.push(`${num(start.x)} ${num(start.y)} l`);

    for (const { c1, c2, end } of curves) {
      ops.push(
        `${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(end.x)} ${num(end.y)} c`,
      );
    }
  });

  ops.push('h', 'S'); // close the loop, then stroke

  // Polygon vertices trace the underlying rectangle. Acrobat uses these, not
  // our appearance stream, when it regenerates the cloud after an edit.
  const vertices = [
    bounds.x, bounds.y,
    bounds.x + bounds.width, bounds.y,
    bounds.x + bounds.width, bounds.y + bounds.height,
    bounds.x, bounds.y + bounds.height,
  ];

  appendAnnotation(pdfDoc, page, {
    Type: 'Annot',
    Subtype: 'Polygon',
    Rect: rect,
    Vertices: vertices,
    ...markupFields({
      author,
      subject: 'Revision cloud',
      createdAt: markup.createdAt,
      color: [r, g, b],
      strokeWidth: width,
    }),
    BE: { S: 'C', I: 2 },
    AP: { N: createAppearance(pdfDoc, rect, ops.join('\n')) },
  });
});
