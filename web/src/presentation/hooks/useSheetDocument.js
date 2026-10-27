import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../ServiceContainer';
import { useSheetIdentity } from '../session/useSheetIdentity';

/**
 * Owns the lifecycle of a loaded PDF: opening a file, selecting a page, and
 * tearing down the pdf.js worker when the document is replaced.
 *
 * Opening and paging a drawing, expressed as state. The actual painting
 * happens in SheetCanvas; this hook only produces the SheetPage that the canvas
 * and the annotation overlay both consume.
 */
export function useSheetDocument() {
  const { documents, workingCopies } = useServices();
  // Inside the open project, so a reopened working copy's markups land on
  // that project's sheets — see SheetScope.
  const sheetIdFor = useSheetIdentity();

  const [state, setState] = useState({
    page: null,
    pageCount: 0,
    pageIndex: 0,
    // What the file is called — shown in the top bar.
    fileName: null,
    // Which drawing it IS: its own name, or for a returned working copy the
    // name of the drawing it was exported from. Sheets, seals and exports are
    // all filed under this, so the copy and the original are one drawing.
    documentName: null,
    // The File handle is retained so export can re-read the original bytes.
    // Caching the ArrayBuffer instead would NOT work: pdf.js detaches the
    // buffer it was given, so the cached copy is zero-length by the time the
    // user clicks Export.
    sourceFile: null,
    isLoading: false,
    error: null,
  });

  // Held in a ref rather than state: replacing a document must dispose the old
  // one's Web Worker, and we need access to it during cleanup without making it
  // a render dependency.
  const documentRef = useRef(null);

  const openPage = useCallback(async (pageIndex) => {
    const document = documentRef.current;
    if (!document) return;
    const page = await document.getPage(pageIndex);
    setState((previous) => ({ ...previous, page, pageIndex }));
  }, []);

  const openFile = useCallback(
    async (file) => {
      setState((previous) => ({ ...previous, isLoading: true, error: null }));

      // Disposing the previous document happens OUTSIDE the try below, and
      // never throws (see PdfJsLoadedDocument.dispose). Releasing an old
      // worker is housekeeping; if it fails, the user still asked to open a
      // file and that must not be reported as the new file being broken.
      documentRef.current?.dispose();
      documentRef.current = null;

      try {
        // A working copy we exported carries its markups. They are restored
        // as live markups BEFORE the drawing loads, and the bytes that come
        // back no longer contain them — otherwise pdf.js would paint them into
        // the page picture underneath the live ones, and the next export would
        // write every markup a second time on top of its old self.
        //
        // Any other PDF comes back as the very same buffer, untouched.
        const original = await file.arrayBuffer();
        const { bytes, documentName, failed } = await workingCopies.open(original, {
          fileName: file.name,
          sheetIdFor,
        });

        // Export re-reads `sourceFile`, so it must hold the cleaned bytes too.
        // Built BEFORE pdf.js sees the buffer, because pdf.js detaches it.
        const sourceFile =
          bytes === original ? file : new File([bytes], file.name, { type: 'application/pdf' });

        const loaded = await documents.load(bytes);
        documentRef.current = loaded;

        setState({
          page: await loaded.getPage(0),
          pageCount: loaded.getPageCount(),
          pageIndex: 0,
          fileName: file.name,
          documentName,
          sourceFile,
          isLoading: false,
          // Not an error that stops anything — the drawing is open and every
          // other markup is live — but the user must know some are not.
          error:
            failed > 0
              ? `${failed} markup(s) in this file could not be brought back, so they are shown read-only.`
              : null,
        });
        // What opened, for a caller that does something with it next — the
        // library saves an admin's new drawing to the project.
        return { fileName: file.name, documentName, sourceFile };
      } catch (error) {
        documentRef.current = null;
        setState({
          page: null,
          pageCount: 0,
          pageIndex: 0,
          fileName: file.name,
          documentName: null,
          sourceFile: null,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [documents, workingCopies, sheetIdFor],
  );

  // Dispose on unmount. pdf.js keeps a worker alive per document; without this,
  // opening several drawings in one session leaks one each time.
  useEffect(() => () => documentRef.current?.dispose(), []);

  return { ...state, openFile, openPage };
}
