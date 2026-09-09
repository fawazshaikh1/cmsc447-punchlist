import { PdfPoint } from '../../domain/geometry/PdfPoint';

/** Chrome's sticky-note yellow, so what the editor shows matches the viewer. */
const NOTE_FILL = '#f2d64b';
const NOTE_STROKE = '#8a6d0b';
const NOTE_SIZE = 20;

/**
 * Draws the annotations that were ALREADY in the uploaded PDF.
 *
 * ===========================================================================
 * WHAT THIS SOLVES
 * ===========================================================================
 * Open a marked-up drawing in Chrome and you see little yellow sticky notes.
 * Open the same file in this editor and — until now — you saw a clean sheet.
 * A user would then re-raise issues the architect had already flagged, and the
 * exported file would carry the same comment twice from two people.
 *
 * These are read-only and drawn beneath the editable layer. They are never
 * re-exported: `PdfLibSheetExporter` copies the original file's bytes, so they
 * are already in the output. See SourceAnnotation for why they are a separate
 * type rather than a seventh registered markup kind.
 *
 * ---------------------------------------------------------------------------
 * POINTER BEHAVIOUR
 * ---------------------------------------------------------------------------
 * These elements DO receive pointer events, so `<title>` tooltips work and a
 * user can read a comment by hovering. That is safe because they carry no
 * `data-annotation-id`, so the layer's hit test returns null for them and a
 * click behaves exactly as it would on empty sheet — deselect, or start drawing.
 */
export function SourceAnnotationLayer({ annotations, project }) {
  if (!annotations || annotations.length === 0) return null;

  return (
    <g className="source-annotations">
      {annotations.map((annotation) => {
        const { bounds } = annotation;

        // Project BOTH corners and take min/max, rather than projecting one and
        // adding the size. That is what keeps these correct at 90 and 270
        // degrees, where the corner that was bottom-left becomes another one.
        let a;
        let b;
        try {
          a = project(new PdfPoint(bounds.x, bounds.y));
          b = project(new PdfPoint(bounds.x + bounds.width, bounds.y + bounds.height));
        } catch {
          // A malformed rect in someone else's PDF is not worth a broken layer.
          return null;
        }

        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const width = Math.abs(b.x - a.x);
        const height = Math.abs(b.y - a.y);

        const tooltip = <title>{annotation.describe()}</title>;

        // Sticky notes have a nominal rect that viewers ignore, drawing a
        // fixed-size icon instead. We do the same, or a note on a 1x1 rect
        // would be invisible.
        if (annotation.isNote() || width < 4 || height < 4) {
          return (
            <g key={annotation.id} transform={`translate(${x}, ${y})`} style={{ cursor: 'help' }}>
              {tooltip}
              <rect
                width={NOTE_SIZE}
                height={NOTE_SIZE * 0.8}
                rx={3}
                fill={annotation.color ?? NOTE_FILL}
                stroke={NOTE_STROKE}
                strokeWidth={1}
              />
              {/* Three short rules, echoing the lined-note icon every PDF
                  viewer uses, so the shape is recognisable at a glance. */}
              {[0.3, 0.5, 0.7].map((t) => (
                <line
                  key={t}
                  x1={NOTE_SIZE * 0.2}
                  x2={NOTE_SIZE * 0.8}
                  y1={NOTE_SIZE * 0.8 * t}
                  y2={NOTE_SIZE * 0.8 * t}
                  stroke={NOTE_STROKE}
                  strokeWidth={1}
                />
              ))}
            </g>
          );
        }

        return (
          <g key={annotation.id} style={{ cursor: 'help' }}>
            {tooltip}
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill="none"
              // Deliberately GREY rather than the annotation's own colour, and
              // faint. An earlier version used the source colour at full
              // opacity, which meant a re-opened export showed a hard red
              // dashed box around every markup the user had just drawn — two
              // near-identical outlines per markup, and no way to tell which
              // was which. Grey and faint reads as "someone else's, for
              // reference" at a glance.
              stroke="#9a9aa2"
              strokeWidth={1}
              strokeDasharray="5 4"
              opacity={0.6}
            />
          </g>
        );
      })}
    </g>
  );
}
