import { PdfPoint } from '../../../domain/geometry/PdfPoint';
import { CLOUD_KIND } from '../../../domain/annotations';
import { scallopArcs } from '../../../domain/annotations/geometry/scallops';
import { MarkerRegistry } from './MarkerRegistry';

/**
 * Draws a revision cloud.
 *
 * Uses the SAME `scallopArcs` generator as the PDF exporter, so what the user
 * draws on the tablet and what the architect opens in Acrobat are the same
 * shape. Only the drawing primitive differs: SVG has a native arc command,
 * while PDF has only Bézier curves.
 *
 * ---------------------------------------------------------------------------
 * THE SWEEP FLAG
 * ---------------------------------------------------------------------------
 * `scallopArcs` produces counter-clockwise arcs in PDF space, where Y points
 * up. Projecting into SVG flips Y, which reverses apparent handedness, so a
 * counter-clockwise PDF arc is a clockwise SVG arc — hence sweep-flag 1.
 *
 * Rotation does not affect this. A rotation preserves handedness; only the
 * reflection introduced by the Y flip reverses it, and that happens exactly
 * once regardless of how the sheet is turned.
 */
function CloudMarker({ annotation: markup, project, isSelected, onSelect }) {
  const arcs = scallopArcs(markup.getBounds(), markup.getArcRadius());
  if (arcs.length === 0) return null;

  // Each arc's endpoints, projected into SVG space.
  const endpoints = arcs.map((arc) => ({
    start: project(new PdfPoint(arc.cx + arc.r * Math.cos(arc.from), arc.cy + arc.r * Math.sin(arc.from))),
    end: project(new PdfPoint(arc.cx + arc.r * Math.cos(arc.to), arc.cy + arc.r * Math.sin(arc.to))),
    r: arc.r,
  }));

  const commands = [`M ${endpoints[0].start.x} ${endpoints[0].start.y}`];
  for (const { end, r } of endpoints) {
    // A r r x-rotation large-arc-flag sweep-flag x y
    commands.push(`A ${r} ${r} 0 0 1 ${end.x} ${end.y}`);
  }
  commands.push('Z');

  return (
    <path
      d={commands.join(' ')}
      fill="transparent"
      stroke={markup.style.color}
      strokeWidth={markup.style.strokeWidth}
      strokeDasharray={isSelected ? `${markup.style.strokeWidth * 3}` : undefined}
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
