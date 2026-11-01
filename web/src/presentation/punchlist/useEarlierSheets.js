import { useContext, useEffect, useState } from 'react';

import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';

const NONE = Object.freeze([]);

/**
 * Every markup on the open drawing's sheets BEFORE the one on screen — what a
 * pin's number counts on from, so pin 4 on sheet 2 is item 4 in the punch list
 * and on the issued PDF too (see ordinalsOnSheet).
 *
 * Read the way the punch list reads: on the server, the project's markups in
 * one request, kept to this drawing's earlier sheets; in browser mode, those
 * sheets one by one. Nothing is read for the first sheet — nothing comes
 * before it.
 *
 * Re-read when the sheet or drawing changes and when the person comes back to
 * the tab, so a teammate's pin on an earlier sheet moves the numbers here
 * without a reload. Until a read lands — and if it fails — the result is
 * empty, which numbers this sheet as if it were the first: never a number
 * borrowed from a different sheet.
 *
 * @param {object} options
 * @param {string|null} options.documentName
 * @param {number} options.pageIndex The sheet on screen, zero-based.
 * @param {(pageIndex: number) => string|null} options.sheetIdFor
 * @returns {import('../../domain/annotations/Annotation').Annotation[]}
 */
export function useEarlierSheets({ documentName, pageIndex, sheetIdFor }) {
  const { projects, annotations } = useServices();
  const project = useContext(SessionContext)?.project ?? null;
  // Tagged with what it was read for, so a sheet never shows the numbers
  // another sheet's read produced while its own is still on the way.
  const [read, setRead] = useState({ key: null, markups: NONE });
  const key = documentName && pageIndex > 0 ? `${documentName}#${pageIndex}` : null;

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;

    const earlierIds = new Set();
    for (let page = 0; page < pageIndex; page++) {
      const sheetId = sheetIdFor(page);
      if (sheetId) earlierIds.add(sheetId);
    }

    const load = async () => {
      if (project && projects) {
        const all = await projects.items(project.id);
        return all.filter((annotation) => earlierIds.has(annotation.sheetId));
      }
      const markups = [];
      for (const sheetId of earlierIds) markups.push(...(await annotations.listForSheet(sheetId)));
      return markups;
    };

    const refresh = () => {
      load().then(
        (markups) => {
          if (!cancelled) setRead({ key, markups });
        },
        // Numbers are a convenience on top of the sheet; a failed read leaves
        // them counting from this sheet rather than putting up an error.
        () => {},
      );
    };
    refresh();

    const onReturn = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [key, pageIndex, sheetIdFor, project, projects, annotations]);

  return read.key === key && key !== null ? read.markups : NONE;
}
