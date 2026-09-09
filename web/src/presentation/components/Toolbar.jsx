/**
 * Controls for loading and viewing a drawing set.
 *
 * Pure presentation — every interaction is forwarded to a callback and no state
 * is held here. That keeps it trivially reusable when the real application
 * shell eventually replaces this spike harness.
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

  return (
    <header className="toolbar">
      <input type="file" accept="application/pdf" onChange={handleFileChange} />

      <span className="muted">{isLoading ? 'Opening…' : (fileName ?? 'No drawing loaded')}</span>

      {pageCount > 1 && (
        <label className="page-picker">
          Sheet
          <select value={pageIndex} onChange={(event) => onSelectPage(Number(event.target.value))}>
            {Array.from({ length: pageCount }, (_, index) => (
              <option key={index} value={index}>
                {index + 1} of {pageCount}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="toolbar-spacer" />

      <button type="button" onClick={onZoomOut} aria-label="Zoom out">
        &minus;
      </button>
      <button type="button" onClick={onResetZoom} className="scale-readout">
        {scale.toFixed(2)}x
      </button>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in">
        +
      </button>
      <button type="button" onClick={onRotate}>
        Rotate 90&deg;
      </button>

      {onExport && (
        <>
          {/* Two export modes, because "correct PDF annotation" and "visible in
              the viewer the client happens to use" are not the same guarantee.
              See FlattenedSheetExporter for the full trade-off. */}
          <button
            type="button"
            className="primary"
            onClick={onExport}
            disabled={isExporting}
            title="Markups stay selectable and repliable in Acrobat's Comments panel. Some viewers render annotations differently."
          >
            {isExporting ? 'Exporting…' : 'Export (editable)'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={onExportFlat}
            disabled={isExporting}
            title="Markups are painted into the page itself. Not selectable, but guaranteed to appear in every PDF viewer."
          >
            {isExporting ? 'Exporting…' : 'Export (flattened)'}
          </button>
        </>
      )}
    </header>
  );
}
