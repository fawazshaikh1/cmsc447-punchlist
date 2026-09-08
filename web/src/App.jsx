import { useCallback, useEffect } from 'react';

import { useServices } from './presentation/ServiceContainer';
import { useSheetDocument } from './presentation/hooks/useSheetDocument';
import { useViewState } from './presentation/hooks/useViewState';
import { useExport } from './presentation/hooks/useExport';
import { SheetViewer } from './presentation/components/SheetViewer';
import { Toolbar } from './presentation/components/Toolbar';

// Loading these three barrels is what registers every annotation type with
// AnnotationRegistry, every marker component with MarkerRegistry, and every
// tool with ToolRegistry. Registration is an import side effect, so it has to
// happen somewhere deliberate — see the comments in each index file.
//
// The fourth registry (PdfWriterRegistry) is populated by PdfLibSheetExporter,
// which imports its own writers barrel.
import './domain/annotations';
import './domain/tools';
import './presentation/components/markers';

/**
 * Application shell for the Sprint 1 / Sprint 2 PDF pipeline.
 *
 * Scaffolding, not product. The real shell will have routing, a project picker,
 * auth and a punch-item panel. What matters architecturally is that replacing
 * it touches nothing below: the domain and infrastructure tiers have no idea
 * this file exists.
 */
export default function App() {
  const {
    page, pageCount, pageIndex, fileName, sourceFile, isLoading, error, openFile, openPage,
  } = useSheetDocument();

  const { scale, rotation, zoomIn, zoomOut, resetZoom, rotateClockwise } = useViewState();
  const { busy: isExporting, message: exportMessage, error: exportError, exportDocument } = useExport();
  const { editor } = useServices();

  // Discard undo history when a different drawing is opened. Commands hold
  // references to the previous document's annotations, and undoing one after
  // switching would write a stale annotation into the new document's storage.
  useEffect(() => {
    editor.reset();
  }, [editor, fileName]);

  // Identity for one sheet.
  //
  // Derived from the file name and page index rather than a random id so it is
  // STABLE ACROSS RELOADS — which is what lets localStorage hand the markups
  // back after F5. In Sprint 2 this becomes the sheet's real database id, which
  // is why `sheetIdFor` is passed to the exporter rather than assumed by it.
  const sheetIdFor = useCallback(
    (index) => (fileName ? `${fileName}#${index}` : null),
    [fileName],
  );

  const sheetId = sheetIdFor(pageIndex);

  const runExport = useCallback(
    (flatten) =>
      void exportDocument({ sourceFile, pageCount, sheetIdFor, author: 'Punch List', flatten }),
    [exportDocument, sourceFile, pageCount, sheetIdFor],
  );

  const handleExport = useCallback(() => runExport(false), [runExport]);
  const handleExportFlat = useCallback(() => runExport(true), [runExport]);

  return (
    <div className="app">
      <Toolbar
        fileName={fileName}
        pageCount={pageCount}
        pageIndex={pageIndex}
        scale={scale}
        isLoading={isLoading}
        onOpenFile={(file) => void openFile(file)}
        onSelectPage={(index) => void openPage(index)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
        onRotate={rotateClockwise}
        onExport={page ? handleExport : undefined}
        onExportFlat={page ? handleExportFlat : undefined}
        isExporting={isExporting}
      />

      {error && <p className="error">{error}</p>}
      {exportError && <p className="error">Export failed: {exportError}</p>}
      {exportMessage && <p className="notice">{exportMessage}</p>}

      {page && sheetId ? (
        <SheetViewer sheetId={sheetId} page={page} scale={scale} rotation={rotation} />
      ) : (
        !isLoading && (
          <div className="empty-state">
            <h1>Punch List &mdash; sheet markup</h1>
            <p>Open an architectural PDF to begin.</p>
            <ol>
              <li>Pick a tool, drop pins and draw markups on the drawing.</li>
              <li>Zoom, rotate and change sheets &mdash; markups stay anchored.</li>
              <li>Reload the page &mdash; they come back in the same places.</li>
              <li>
                Export the marked-up PDF and open it in Acrobat &mdash; every markup is a
                real, selectable PDF annotation, not a flattened picture.
              </li>
            </ol>
          </div>
        )
      )}
    </div>
  );
}
