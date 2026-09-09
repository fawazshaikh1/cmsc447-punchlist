import { useCallback, useState } from 'react';
import { useServices } from '../ServiceContainer';

/**
 * Runs the "download the marked-up PDF" use case and tracks its progress.
 *
 * The download itself happens here rather than in the domain: creating an
 * object URL and clicking a synthetic link is a browser concern, and
 * `ExportService` should stay usable from a Node worker in Sprint 3 without
 * knowing what a DOM is.
 */
export function useExport() {
  const { exports, exportsFlattened } = useServices();
  const [status, setStatus] = useState({ busy: false, message: null, error: null });

  const exportDocument = useCallback(
    async ({ sourceFile, pageCount, sheetIdFor, author, flatten = false }) => {
      if (!sourceFile) return;

      setStatus({ busy: true, message: 'Reading drawing…', error: null });

      try {
        // Re-read from the File handle rather than caching the ArrayBuffer.
        // pdf.js DETACHES the buffer it was given when the document was opened,
        // so a cached copy would be zero-length by now. The File itself stays
        // valid for the life of the page.
        const sourceBytes = await sourceFile.arrayBuffer();

        const service = flatten ? exportsFlattened : exports;
        const { bytes, annotatedPages, annotationCount } = await service.exportDocument({
          sourceBytes,
          pageCount,
          sheetIdFor,
          author,
          onProgress: (done, total) =>
            setStatus({ busy: true, message: `Collecting markups ${done}/${total}…`, error: null }),
        });

        if (annotationCount === 0) {
          setStatus({ busy: false, message: 'Nothing to export — no markups yet.', error: null });
          return;
        }

        download(
          bytes,
          sourceFile.name.replace(/\.pdf$/i, '') +
            (flatten ? '-marked-up-flat.pdf' : '-marked-up.pdf'),
        );

        setStatus({
          busy: false,
          error: null,
          message: `Exported ${annotationCount} markup(s) across ${annotatedPages} sheet(s).`,
        });
      } catch (error) {
        setStatus({
          busy: false,
          message: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [exports, exportsFlattened],
  );

  return { ...status, exportDocument };
}

/**
 * Hands the bytes to the browser as a file download.
 *
 * The object URL is revoked on a timeout rather than immediately: revoking
 * synchronously after `click()` races the browser's own read of the URL, and
 * some builds end up saving a zero-byte file. A second is far longer than the
 * handoff needs and costs nothing.
 */
function download(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
