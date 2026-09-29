import { Icon } from './Icon';

/**
 * The top bar: which drawing is open, which sheet, how it is being looked at,
 * and how it leaves.
 *
 * Pure presentation — every interaction is forwarded to a callback and no state
 * is held here.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TWO EXPORTS ARE NOT EQUALLY WEIGHTED
 * ---------------------------------------------------------------------------
 * "Issue" is the one that matters and the one that cannot be undone, so it gets
 * the accent. "Working copy" is the safe, reversible one and sits quietly next
 * to it. Giving both the same weight would make the irreversible action as easy
 * to hit by accident as the reversible one.
 *
 * @param {object} props
 * @param {string | null} props.fileName
 * @param {number} props.pageCount
 * @param {number} props.pageIndex
 * @param {number} props.scale
 * @param {boolean} props.isLoading
 * @param {(file: File) => void} props.onOpenFile
 * @param {(pageIndex: number) => void} props.onSelectPage
 * @param {() => void} props.onZoomIn
 * @param {() => void} props.onZoomOut
 * @param {() => void} props.onResetZoom
 * @param {() => void} props.onRotate
 * @param {() => void} [props.onExport] Omitted when no document is open.
 * @param {() => void} [props.onExportFlat]
 * @param {boolean} [props.isExporting]
 */
export function Toolbar({
  fileName,
  pageCount,
  pageIndex,
  scale,
  isLoading,
  onOpenFile,
  onSelectPage,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onRotate,
  onExport,
  onExportFlat,
  isExporting,
}) {
  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onOpenFile(file);

    // Reset so selecting the SAME file twice still fires a change event —
    // otherwise "reopen the drawing I just closed" silently does nothing.
    event.target.value = '';
  };

  const canPage = pageCount > 1;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="pin" size={18} />
        </span>
        <span className="brand-name">Punch List</span>
      </div>

      <label className="btn file-button" title="Open an architectural PDF">
        <Icon name="file" size={18} />
        {fileName ? 'Open another' : 'Open drawing'}
        <input type="file" accept="application/pdf" onChange={handleFileChange} />
      </label>

      {(fileName || isLoading) && (
        <span className="doc-chip">
          <Icon name="layers" size={16} />
          <strong>{isLoading ? 'Opening…' : fileName}</strong>
        </span>
      )}

      {canPage && (
        <div className="sheet-nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => onSelectPage(pageIndex - 1)}
            disabled={pageIndex === 0}
            aria-label="Previous sheet"
            title="Previous sheet"
          >
            <span aria-hidden="true">&#8249;</span>
          </button>

          <select
            value={pageIndex}
            onChange={(event) => onSelectPage(Number(event.target.value))}
            aria-label="Sheet"
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <option key={index} value={index}>
                Sheet {index + 1} of {pageCount}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="icon-button"
            onClick={() => onSelectPage(pageIndex + 1)}
            disabled={pageIndex >= pageCount - 1}
            aria-label="Next sheet"
            title="Next sheet"
          >
            <span aria-hidden="true">&#8250;</span>
          </button>
        </div>
      )}

      <div className="topbar-spacer" />

      <div className="topbar-group">
        <button
          type="button"
          className="icon-button"
          onClick={onZoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Icon name="zoomOut" />
        </button>

        <button
          type="button"
          className="icon-button readout mono"
          onClick={onResetZoom}
          title="Reset zoom to 100%"
        >
          {Math.round(scale * 100)}%
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={onZoomIn}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Icon name="zoomIn" />
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={onRotate}
          aria-label="Rotate 90 degrees"
          title="Rotate 90°"
        >
          <Icon name="rotate" />
        </button>
      </div>

      {onExport && (
        <>
          <button
            type="button"
            className="btn"
            onClick={onExport}
            disabled={isExporting}
            title="Markups stay selectable and repliable in Acrobat's Comments panel. Nothing is locked."
          >
            <Icon name="download" size={18} />
            {isExporting ? 'Exporting…' : 'Working copy'}
          </button>

          <button
            type="button"
            className="btn primary"
            onClick={onExportFlat}
            disabled={isExporting}
            title="Paints every markup into the drawing. Guaranteed to appear in any viewer — and makes those markups permanent."
          >
            <Icon name="lock" size={18} />
            {isExporting ? 'Exporting…' : 'Issue PDF'}
          </button>
        </>
      )}
    </header>
  );
}
