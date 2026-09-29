import { PdfPoint } from '../../../domain/geometry/PdfPoint';
import { CLOUD_KIND } from '../../../domain/annotations';
import { scallopArcs, arcToBeziers } from '../../../domain/annotations/geometry/scallops';
import { MarkerRegistry } from './MarkerRegistry';

/**
 * Draws a revision cloud.
 *
 * ===========================================================================
 * WHY THIS DRAWS BÉZIERS RATHER THAN SVG ARCS
 * ===========================================================================
 * SVG has a native arc command, and using it looked like the obvious choice —
 * until the bumps became major arcs.
 *
 * `A rx ry rot large-arc sweep x y` does not say WHICH circle to use. Given two
 * endpoints and a radius there are two candidate circles, and the two flags
 * select one of the four resulting arcs between them. While every bump was a
 * semicircle the choice was unambiguous enough to get right by reasoning about
 * the Y flip. With a 240-degree bump it is not: the flag pair that looks
 * correct picks the major arc on the MIRRORED circle, and every bump renders as
 * a loop crossing its own base — a row of small "e" shapes rather than a cloud.
 *
 * `arcToBeziers` has no such ambiguity. It emits explicit control points from
 * the centre, radius and angles that `scallopArcs` already computed, so there
 * is exactly one curve it can produce.
 *
 * It also makes the shared-geometry promise literal rather than approximate:
 * the exporter runs the same two functions over the same numbers, so the cloud
 * on the tablet and the cloud in the architect's PDF are the same curve, not
 * two renderings that happen to agree.
 */
function CloudMarker({ annotation: markup, project, isSelected, onSelect }) {
  const arcs = scallopArcs(markup.getBounds(), markup.getArcRadius());
  if (arcs.length === 0) return null;

  const commands = [];

  arcs.forEach((arc, index) => {
    const { start, curves } = arcToBeziers(arc);

    // Only the first bump needs a move; the rest continue the outline, which is
    // what makes the cusps between bumps meet exactly.
    if (index === 0) {
      const from = project(new PdfPoint(start.x, start.y));
      commands.push(`M ${from.x} ${from.y}`);
    }

    for (const { c1, c2, end } of curves) {
      const p1 = project(new PdfPoint(c1.x, c1.y));
      const p2 = project(new PdfPoint(c2.x, c2.y));
      const p3 = project(new PdfPoint(end.x, end.y));
      commands.push(`C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`);
    }
  });

  commands.push('Z');

  return (
    <path
      d={commands.join(' ')}
      fill="transparent"
      stroke={markup.style.color}
      strokeWidth={markup.style.strokeWidth}
      strokeDasharray={isSelected ? `${markup.style.strokeWidth * 3}` : undefined}
      // Round joins, because a cloud's cusps are where two bumps meet and a
      // mitre there spikes outward at small stroke widths.
      strokeLinejoin="round"
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(markup);
      }}
    />
  );
}

MarkerRegistry.register(CLOUD_KIND, CloudMarker);
export { CloudMarker };
