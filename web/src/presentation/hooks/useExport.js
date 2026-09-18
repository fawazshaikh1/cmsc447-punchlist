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
  const { exports, exportsFlattened, activeSeals, editor } = useServices();
  const [status, setStatus] = useState({ busy: false, message: null, error: null });

  /** Whether the flattened option would seal, so the caller can warn first. */
  const flattenedSeals = exportsFlattened.seals();

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
        const { bytes, annotatedPages, annotationCount, sealed } =
          await service.exportDocument({
            sourceBytes,
            pageCount,
            sheetIdFor,
            author,
            documentName: sourceFile.name,
            onProgress: (done, total) =>
              setStatus({
                busy: true,
                message: `Collecting markups ${done}/${total}…`,
                error: null,
              }),
          });

        if (annotationCount === 0) {
          setStatus({ busy: false, message: 'Nothing to export — no markups yet.', error: null });
          return;
        }

        // ---------------------------------------------------------------
        // APPLY THE SEAL TO THE RUNNING SESSION
        // ---------------------------------------------------------------
        // It is already in storage — ExportService wrote the record. This makes
        // it visible NOW, so the panel locks the moment the file is issued
        // rather than on the next sheet change. Without it the user could keep
        // editing markups that the service has already started refusing, and
        // meet the refusal as an error instead of a disabled field.
        if (sealed) {
          activeSeals.add(Object.values(sealed.annotationIdsBySheet).flat());

          // Undo is the other way back to a sealed markup, and the policy cannot
          // see it: a command replays a stored write directly. Clearing the
          // history closes that door. The cost is the user's undo stack, which
          // is a fair trade at the moment they issue a document — and the
          // alternative is an undo button that quietly breaks a promise.
          editor.reset();
        }

        download(
          bytes,
          sourceFile.name.replace(/\.pdf$/i, '') +
            (flatten ? '-marked-up-flat.pdf' : '-marked-up.pdf'),
        );

        setStatus({
          busy: false,
          error: null,
          message:
            `Exported ${annotationCount} markup(s) across ${annotatedPages} sheet(s).` +
            (sealed ? ' They are now issued and read-only.' : ''),
        });
      } catch (error) {
        setStatus({
          busy: false,
          message: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [exports, exportsFlattened, activeSeals, editor],
  );

  return { ...status, exportDocument, flattenedSeals };
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
