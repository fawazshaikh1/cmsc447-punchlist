/**
 * The application's icon set.
 *
 * ===========================================================================
 * WHY THESE ARE DRAWN HERE RATHER THAN INSTALLED
 * ===========================================================================
 * An icon library is the obvious answer and the wrong one for this app. The
 * tool palette needs a pin, a revision cloud, a leader arrow and a freehand
 * mark — four shapes that mean something specific in construction markup and
 * that no general-purpose set draws the way a superintendent expects. A generic
 * "cloud" icon means weather.
 *
 * So the markup tools get glyphs that look like what they produce, and the
 * ordinary interface icons (camera, upload, undo) are drawn in the same weight
 * so the palette does not look assembled from two sources.
 *
 * It also keeps the bundle honest: eighteen paths instead of a dependency.
 *
 * ---------------------------------------------------------------------------
 * THE RULES EVERY GLYPH FOLLOWS
 * ---------------------------------------------------------------------------
 * One 24x24 viewBox, 1.75 stroke, round caps and joins, `currentColor`. That
 * last one is what lets a single definition sit on a dark toolbar and a light
 * panel without a variant, and what makes the active-tool state a colour change
 * on the parent rather than a second icon.
 */

const PATHS = {
  // --- markup tools: each glyph resembles what the tool draws ---------------
  select: <path d="M5 3l6.5 16 2.2-6.3L20 10.5z" />,
  pin: (
    <>
      <path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
  box: <rect x="3.5" y="5.5" width="17" height="13" rx="1" />,
  cloud: (
    <path d="M4 14.5a2.6 2.6 0 0 1 2.6-2.6 3.4 3.4 0 0 1 3.3-3.4 3.2 3.2 0 0 1 5.6 1 2.9 2.9 0 0 1 2.9 2.9 2.7 2.7 0 0 1-.6 4.1H6.4A2.6 2.6 0 0 1 4 14.5z" />
  ),
  arrow: (
    <>
      <path d="M4 20L20 4" />
      <path d="M13 4h7v7" />
    </>
  ),
  draw: <path d="M3 18c3.5 0 3-9 6.5-9S13 20 16.5 20 21 9 21 9" />,
  text: (
    <>
      <path d="M5 6.5V5h14v1.5" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <circle cx="9" cy="11.5" r="1.8" />
      <path d="M3.5 18l4.8-4.3a1.6 1.6 0 0 1 2.2 0l3.3 3 1.9-1.6a1.6 1.6 0 0 1 2.1 0l2.7 2.4" />
    </>
  ),

  // --- interface -----------------------------------------------------------
  camera: (
    <>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1.5 1.5 0 0 1 9.1 4.5h5.8a1.5 1.5 0 0 1 1.3.7L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="12.8" r="3.4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9h10a5.5 5.5 0 0 1 0 11h-4" />
      <path d="M7.5 5.5L4 9l3.5 3.5" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9H10a5.5 5.5 0 0 0 0 11h4" />
      <path d="M16.5 5.5L20 9l-3.5 3.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
      <path d="M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
      <path d="M7.5 10.5h6" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
      <path d="M6.5 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="1.6" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5L21.5 20H2.5z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.2v.1" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  close: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />,
  file: (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
    </>
  ),
  switchCamera: (
    <>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1.5 1.5 0 0 1 9.1 4.5h5.8a1.5 1.5 0 0 1 1.3.7L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <path d="M9.6 12.8h4.8" />
      <path d="M12.8 11.2l1.6 1.6-1.6 1.6" />
    </>
  ),
};

/**
 * @param {object} props
 * @param {keyof typeof PATHS} props.name
 * @param {number} [props.size] Square, in px. 20 in dense chrome, 24 in dialogs.
 * @param {string} [props.title] Give this ONLY when the icon stands alone with
 *        no visible label — an icon that repeats adjacent text should stay
 *        `aria-hidden`, or a screen reader announces the same thing twice.
 */
export function Icon({ name, size = 20, title, ...rest }) {
  const path = PATHS[name];

  // A missing name renders nothing rather than throwing: an icon is decoration,
  // and a typo in one should never take down the toolbar around it.
  if (!path) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {path}
    </svg>
  );
}

/** Icon names, for anything that needs to check one exists. */
export const ICON_NAMES = Object.keys(PATHS);
