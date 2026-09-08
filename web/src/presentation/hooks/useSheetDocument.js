import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../ServiceContainer';

/**
 * Owns the lifecycle of a loaded PDF: opening a file, selecting a page, and
 * tearing down the pdf.js worker when the document is replaced.
 *
 * This is the SCRUM-18 deliverable expressed as state. The actual painting
 * happens in SheetCanvas; this hook only produces the SheetPage that the canvas
 * and the annotation overlay both consume.
 */
export function useSheetDocument() {
  const { documents } = useServices();

  const [state, setState] = useState({
    page: null,
    pageCount: 0,
    pageIndex: 0,
    fileName: null,
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
        const loaded = await documents.load(await file.arrayBuffer());
        documentRef.current = loaded;

        setState({
          page: await loaded.getPage(0),
          pageCount: loaded.getPageCount(),
          pageIndex: 0,
          fileName: file.name,
          sourceFile: file,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        documentRef.current = null;
        setState({
          page: null,
          pageCount: 0,
          pageIndex: 0,
          fileName: file.name,
          sourceFile: null,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [documents],
  );

  // Dispose on unmount. pdf.js keeps a worker alive per document; without this,
  // opening several drawings in one session leaks one each time.
  useEffect(() => () => documentRef.current?.dispose(), []);

  return { ...state, openFile, openPage };
}
