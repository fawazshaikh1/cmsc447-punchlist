import { INK_KIND } from '../../../domain/annotations';
import { MarkerRegistry } from './MarkerRegistry';

/**
 * Draws a freehand stroke.
 *
 * Rendered as a `<polyline>` with round caps and joins. Round joins matter more
 * than they sound: with the default mitre joins, a stroke sampled every 1.5pt
 * shows a visible spike wherever the path turns sharply, which reads as a
 * glitch rather than as ink.
 *
 * `vectorEffect="non-scaling-stroke"` is deliberately NOT used — the stroke
 * width is in PDF points and should scale with the drawing, so a stroke drawn
 * at 400% zoom stays the same thickness relative to the sheet when zoomed out.
 * That matches how a physical marker behaves and how the export will look.
 */
function InkMarker({ annotation: markup, project, isSelected, onSelect }) {
  const points = markup.points.map((point) => {
    const projected = project(point);
    return `${projected.x},${projected.y}`;
  });

  const width = markup.style.strokeWidth;

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(markup);
      }}
    >
      {/* Invisible wide stroke as the hit target — a 2pt squiggle is almost
          impossible to tap accurately with a finger. */}
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(width * 6, 14)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={markup.style.color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={isSelected ? `${width * 3}` : undefined}
      />
    </g>
  );
}

MarkerRegistry.register(INK_KIND, InkMarker);
export { InkMarker };
