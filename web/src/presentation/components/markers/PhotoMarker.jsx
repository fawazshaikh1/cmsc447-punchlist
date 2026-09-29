import { PHOTO_KIND } from '../../../domain/annotations';
import { useMediaUrl } from '../../media/useMediaUrl';
import { MarkerRegistry } from './MarkerRegistry';

/** Frame stroke, in PDF points. Matches photoWriter so screen and export agree. */
const FRAME = 1.5;

/** The markup red, shared with the exported frame. */
const FRAME_COLOR = '#C8442B';

/**
 * Draws a photograph on the sheet.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GEOMETRY COMES FROM THE MODEL, NOT THE IMAGE
 * ---------------------------------------------------------------------------
 * The frame is laid out from `getBounds()` before the image has loaded, so the
 * photo does not pop in at one size and resize when it arrives. That matters on
 * a tablet over a site connection, where the placeholder can be on screen for a
 * second — a layout that jumps under the user's finger is worse than a slow one.
 *
 * It is also why `PhotoMarkup` stores the dimensions: the aspect ratio is known
 * without decoding anything.
 *
 * ---------------------------------------------------------------------------
 * PROJECTED CORNERS, NOT A PROJECTED POINT PLUS A SIZE
 * ---------------------------------------------------------------------------
 * Both corners go through `project`, so the rectangle is correct at every
 * rotation. Projecting the anchor and then adding the width in points would be
 * right at 0 degrees and wrong at 90 — the classic bug this overlay's whole
 * coordinate discipline exists to prevent.
 */
function PhotoMarker({ annotation: photo, project, isSelected, onSelect }) {
  const { url, loading } = useMediaUrl(photo.media.key);

  // `getCorners`, not `getBounds`: `project` is a CoordinateTransformer and it
  // refuses anything that is not a PdfPoint. See PhotoMarkup.getCorners.
  const { topLeft, bottomRight } = photo.getCorners();
  const start = project(topLeft);
  const end = project(bottomRight);

  // Normalised so the rect is valid whichever way the projection ran — at 180
  // degrees the "top left" comes out below and right of the other corner.
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(photo);
      }}
    >
      {/* White backing: a photo with pale areas still reads as a placed object
          over dark linework, and it is what the exported appearance draws. */}
      <rect x={x} y={y} width={width} height={height} fill="#ffffff" />

      {url && (
        <image
          href={url}
          x={x}
          y={y}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid slice"
        />
      )}

      {!url && (
        <>
          {/* Loading shows an empty frame; genuinely missing shows a cross, so
              the two states are never confused with each other. */}
          {!loading && (
            <>
              <line x1={x} y1={y} x2={x + width} y2={y + height} stroke={FRAME_COLOR} strokeWidth={1} />
              <line x1={x} y1={y + height} x2={x + width} y2={y} stroke={FRAME_COLOR} strokeWidth={1} />
            </>
          )}
          <title>{loading ? 'Loading photo' : 'This photo is not on this device'}</title>
        </>
      )}

      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke={isSelected ? '#16222F' : FRAME_COLOR}
        strokeWidth={isSelected ? FRAME * 2 : FRAME}
      />

      {photo.caption && <title>{photo.caption}</title>}
    </g>
  );
}

MarkerRegistry.register(PHOTO_KIND, PhotoMarker);
export { PhotoMarker };
