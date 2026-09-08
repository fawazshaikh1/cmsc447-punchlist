import { PdfPoint } from '../../../domain/geometry/PdfPoint';
import { RECTANGLE_KIND } from '../../../domain/annotations';
import { MarkerRegistry } from './MarkerRegistry';

/**
 * Draws a box markup.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CORNERS ARE PROJECTED RATHER THAN USED DIRECTLY
 * ---------------------------------------------------------------------------
 * `getBounds()` is in PDF user space: origin bottom-left, Y increasing upward.
 * SVG is origin top-left, Y increasing downward — and on top of that the user
 * may have rotated the sheet.
 *
 * `project()` runs both corners through the layer's scale-1 transformer, which
 * applies the Y flip and the rotation in one step. Projecting BOTH corners and
 * then taking min/max is what makes this correct at 90 and 270 degrees, where
 * the corner that was bottom-left becomes something else entirely. Projecting
 * one corner and adding the width would be wrong at those rotations — and,
 * being invisible at the default rotation, would ship.
 */
function RectangleMarker({ annotation: markup, project, isSelected, onSelect }) {
  const bounds = markup.getBounds();

  const a = project(new PdfPoint(bounds.x, bounds.y));
  const b = project(new PdfPoint(bounds.x + bounds.width, bounds.y + bounds.height));

  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
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

MarkerRegistry.register(RECTANGLE_KIND, RectangleMarker);
export { RectangleMarker };
