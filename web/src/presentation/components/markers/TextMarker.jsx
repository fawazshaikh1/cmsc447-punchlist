import { TEXT_KIND, TextMarkup } from '../../../domain/annotations';
import { MarkerRegistry } from './MarkerRegistry';

/**
 * Draws a text callout.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TEXT IS COUNTER-ROTATED
 * ---------------------------------------------------------------------------
 * Everything else in the overlay lives in the sheet's coordinate space, so
 * rotating the sheet rotates the markup with it — which is correct for a box or
 * an arrow, since those describe locations on the drawing.
 *
 * Text is different: rotating the sheet 90 degrees should not leave the notes
 * unreadable. So the glyphs are counter-rotated about their anchor, keeping the
 * callout upright on screen while its POSITION still tracks the drawing.
 *
 * Note this affects the screen only. The exported `/FreeText` annotation is
 * written in page coordinates, unrotated, which is what a reviewer opening the
 * PDF at its natural orientation expects.
 */
function TextMarker({ annotation: markup, project, rotation, isSelected, onSelect }) {
  const anchor = project(markup.getAnchor());
  const lines = markup.text.split('\n');
  const size = markup.fontSize;

  return (
    <g
      transform={`translate(${anchor.x}, ${anchor.y}) rotate(${-(rotation ?? 0)})`}
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(markup);
      }}
    >
      {isSelected && (
        <rect
          x={-2}
          y={-2}
          width={Math.max(...lines.map((l) => l.length)) * size * 0.55 + 4}
          height={size * TextMarkup.LINE_HEIGHT_RATIO * lines.length + 4}
          fill="none"
          stroke={markup.style.color}
          strokeWidth={1}
          strokeDasharray="3"
        />
      )}
      <text
        fontSize={size}
        fontFamily="system-ui, sans-serif"
        fill={markup.style.color}
        style={{ userSelect: 'none' }}
      >
        {lines.map((line, index) => (
          // The FIRST baseline drops a full font size below the anchor, so the
          // anchor is the top-left of the block and text flows downward from
          // the tap. With dy=0 the glyphs would sit ABOVE the tap and a callout
          // placed near the top of a sheet rendered clipped in half — the bug
          // this fixes. See TextMarkup.getBounds.
          <tspan key={index} x={0} dy={index === 0 ? size : size * TextMarkup.LINE_HEIGHT_RATIO}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

MarkerRegistry.register(TEXT_KIND, TextMarker);
export { TextMarker };
