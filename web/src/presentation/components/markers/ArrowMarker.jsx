import { PdfPoint } from '../../../domain/geometry/PdfPoint';
import { ARROW_KIND } from '../../../domain/annotations';
import { MarkerRegistry } from './MarkerRegistry';

/**
 * Draws a directional arrow.
 *
 * The arrowhead barbs come from `ArrowMarkup.getHeadBarbs()` — the same domain
 * method the PDF exporter calls. Neither renderer does its own trigonometry, so
 * the head cannot drift between the screen and the export. If the head angle
 * ever needs changing, it changes in the model and both renderers follow.
 */
function ArrowMarker({ annotation: markup, project, isSelected, onSelect }) {
  const tail = project(markup.start);
  const head = project(markup.end);

  const barbs = markup.getHeadBarbs();
  const left = project(new PdfPoint(barbs.left.x, barbs.left.y));
  const right = project(new PdfPoint(barbs.right.x, barbs.right.y));

  const width = markup.style.strokeWidth;

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(markup);
      }}
    >
      {/* Invisible fat stroke underneath, so the arrow can be tapped on a
          tablet without hitting a 2pt line exactly. Purely a hit target. */}
      <line
        x1={tail.x} y1={tail.y} x2={head.x} y2={head.y}
        stroke="transparent" strokeWidth={Math.max(width * 6, 12)}
      />
      <line
        x1={tail.x} y1={tail.y} x2={head.x} y2={head.y}
        stroke={markup.style.color}
        strokeWidth={width}
        strokeDasharray={isSelected ? `${width * 3}` : undefined}
      />
      <polygon
        points={`${head.x},${head.y} ${left.x},${left.y} ${right.x},${right.y}`}
        fill={markup.style.color}
      />
    </g>
  );
}

MarkerRegistry.register(ARROW_KIND, ArrowMarker);
export { ArrowMarker };
