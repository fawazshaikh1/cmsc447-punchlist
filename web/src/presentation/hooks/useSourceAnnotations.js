import { useEffect, useState } from 'react';

/**
 * Loads the annotations already present in the uploaded PDF for one page.
 *
 * Separate from `useSheetEditor` because these are a different kind of thing
 * entirely: read-only, owned by whoever made the file, tied to the PAGE rather
 * than to our sheet record, and never written. Mixing them into the editing
 * session would mean guarding every mutation against "but not that kind".
 *
 * Re-reads on every page change. pdf.js caches parsed annotations per page
 * object, so flipping back and forth through a 153-page set does not re-parse.
 *
 * @param {import('../../domain/ports/DocumentSource').SheetPage | null} page
 */
export function useSourceAnnotations(page) {
  const [annotations, setAnnotations] = useState([]);

  useEffect(() => {
    if (!page) {
      setAnnotations([]);
      return undefined;
    }

    // Guards against a slow page's result arriving after the user has already
    // moved on — otherwise sheet 12's comments can land on sheet 13.
    let current = true;

    page
      .getSourceAnnotations()
      .then((loaded) => {
        if (current) setAnnotations(loaded);
      })
      .catch(() => {
        // The adapter already logs and returns [] for a malformed dictionary.
        // Reaching here means something worse, and a drawing that renders is
        // still far more useful than an error over someone else's comments.
        if (current) setAnnotations([]);
      });

    return () => {
      current = false;
    };
  }, [page]);

  return annotations;
}
