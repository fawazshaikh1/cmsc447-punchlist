import { useCallback, useEffect, useState } from 'react';

import { useServices } from './presentation/ServiceContainer';
import { useSheetDocument } from './presentation/hooks/useSheetDocument';
import { useViewState } from './presentation/hooks/useViewState';
import { useExport } from './presentation/hooks/useExport';
import { SheetViewer } from './presentation/components/SheetViewer';
import { Toolbar } from './presentation/components/Toolbar';
import { useConfirmation } from './presentation/components/ConfirmDialog';
import { Icon } from './presentation/components/Icon';
import { FlattenExportNotice } from './presentation/components/SealingNotice';

// Loading these three barrels is what registers every annotation type with
// AnnotationRegistry, every marker component with MarkerRegistry, and every
// tool with ToolRegistry. Registration is an import side effect, so it has to
// happen somewhere deliberate — see the comments in each index file.
//
// The fourth registry (PdfWriterRegistry) is populated by PdfLibSheetExporter,
// which imports its own writers barrel.
import './domain/annotations';
import './domain/tools';
// Registers the completeness rules the product enforces — today, that a pin
// must carry a description. See domain/rules/index.js for why registration
// lives in the barrel rather than in each rule's own file.
import './domain/rules';
import './presentation/components/markers';

/**
 * Application shell.
 *
 * Three regions: a top bar for the document and how it leaves, a tool rail down
 * the left, and the sheet with its properties panel. `SheetViewer` renders the
 * last three as siblings so they are direct children of the `.app-body` grid —
 * which is what lets the panel become a slide-over at tablet width without any
 * of them being re-nested.
 *
 * Still only a shell: routing, a project picker and sign-in all land in Sprint
 * 2. What matters architecturally is that replacing it touches nothing below.
 * The domain and infrastructure tiers have no idea this file exists.
 */
export default function App() {
  const {
    page, pageCount, pageIndex, fileName, sourceFile, isLoading, error, openFile, openPage,
  } = useSheetDocument();

  const { scale, rotation, zoomIn, zoomOut, resetZoom, rotateClockwise } = useViewState();
  const { busy: isExporting, message: exportMessage, error: exportError, exportDocument } = useExport();
  const { editor, exportsFlattened } = useServices();
  const { ask, dialog } = useConfirmation();
  // Failures from the checks that run BEFORE the export confirmation, which
  // useExport never sees because the export has not started yet.
  const [exportPrecheckError, setExportPrecheckError] = useState(null);

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

  /**
   * The flattened export, behind a confirmation.
   *
   * This is the only irreversible action in the product: it issues the drawing
   * and makes every markup in it permanent. The user is told exactly how much
   * work that covers before they commit, because "31 markups on 4 sheets" is
   * something they can weigh and a generic warning is not.
   *
   * The count is read fresh here rather than tracked, so it is the truth at the
   * moment of asking. If the exporter were ever swapped for one that does not
   * flatten, `seals()` would say so and the question would not be asked — the
   * dialog follows the capability, not the button.
   */
  const handleExportFlat = useCallback(async () => {
    if (!exportsFlattened.seals()) {
      runExport(true);
      return;
    }

    const { annotationCount, sheetCount, incompleteCount } =
      await exportsFlattened.summarize({ pageCount, sheetIdFor });

    // None of OUR markups means nothing of ours gets sealed — but the file may
    // still be covered in markups from a previous export, and flattening those
    // is exactly what the user is asking for. So run it, and let the export
    // report what it actually burned in.
    //
    // No confirmation in this case, deliberately: the seal is what the warning
    // is about, and with nothing of ours to seal there is nothing to warn of.
    if (annotationCount === 0) {
      runExport(true);
      return;
    }

    const confirmed = await ask({
      title: 'Issue a flattened PDF?',
      body: (
        <FlattenExportNotice
          annotationCount={annotationCount}
          sheetCount={sheetCount}
          incompleteCount={incompleteCount}
        />
      ),
      confirmLabel: `Issue and lock ${annotationCount} markup(s)`,
      cancelLabel: 'Cancel',
      tone: 'danger',
    });

    if (confirmed) runExport(true);
  }, [exportsFlattened, pageCount, sheetIdFor, ask, runExport]);

  /**
   * The click handler proper.
   *
   * `handleExportFlat` reads storage before it can ask its question, and a
   * rejection there would otherwise become an unhandled promise — the button
   * would appear to do nothing at all. Surfaced through the same banner the
   * export itself uses, so there is one place a user looks when export
   * misbehaves.
   */
  const onExportFlatClicked = useCallback(() => {
    handleExportFlat().catch((cause) => {
      setExportPrecheckError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [handleExportFlat]);

  return (
    <div className="app">
      {dialog}

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
        onExportFlat={page ? onExportFlatClicked : undefined}
        isExporting={isExporting}
      />

      {(error || exportError || exportPrecheckError || exportMessage) && (
        <div className="banner-row">
          {error && (
            <p className="error">
              <Icon name="alert" size={18} /> {error}
            </p>
          )}
          {(exportError || exportPrecheckError) && (
            <p className="error">
              <Icon name="alert" size={18} /> Export failed: {exportError ?? exportPrecheckError}
            </p>
          )}
          {exportMessage && (
            <p className="notice">
              <Icon name="check" size={18} /> {exportMessage}
            </p>
          )}
        </div>
      )}

      {page && sheetId ? (
        <div className="app-body">
          <SheetViewer
            sheetId={sheetId}
            documentName={fileName}
            page={page}
            scale={scale}
            rotation={rotation}
          />
        </div>
      ) : (
        <div className="stage stage-empty">
          {!isLoading && (
            <div className="empty-state">
              <h1>Mark up a drawing, issue it as a PDF</h1>
              <p>
                Open an architectural or engineering PDF to begin. Everything stays on this
                device until you export &mdash; nothing is uploaded.
              </p>
              <ol className="empty-steps">
                <li>Pick a tool from the left, then tap the drawing to place a markup.</li>
                <li>
                  Add a photo straight from the camera, or from a file, and it lands on the
                  sheet where you tapped.
                </li>
                <li>
                  Zoom, rotate and change sheets &mdash; every markup holds its exact point on
                  the drawing. Reload and they come back.
                </li>
                <li>
                  Issue the PDF and open it in Acrobat, Bluebeam or PlanGrid. The original
                  drawing is never modified.
                </li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
