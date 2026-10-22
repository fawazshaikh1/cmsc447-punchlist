import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';

/**
 * The markups the punch list is built from.
 *
 * On the server, every drawing in the open project — one request. In browser
 * mode there is no project, so it is the drawing on screen, sheet by sheet.
 *
 * Read while the list is showing: when it is opened, after an edit on the
 * sheet (`changeKey` changes), and when the person comes back to the tab, so
 * a teammate's items appear without a reload. A failed read keeps whatever was
 * shown before and says why.
 *
 * @param {object} options
 * @param {boolean} options.active Whether the list is on screen.
 * @param {string|null} options.documentName The drawing on screen.
 * @param {number} options.pageCount
 * @param {(pageIndex: number) => string|null} options.sheetIdFor
 * @param {unknown} options.changeKey Changes when the open sheet's markups do.
 * @returns {{ items: import('../../domain/annotations/Annotation').Annotation[]|null, error: string|null, reload: () => void }}
 */
export function usePunchListItems({ active, documentName, pageCount, sheetIdFor, changeKey }) {
  const { projects, annotations } = useServices();
  const project = useContext(SessionContext)?.project ?? null;
  const [state, setState] = useState({ items: null, error: null });
  const generation = useRef(0);

  /** @param {unknown} [_why] What prompted it — read only by the effect's dependencies. */
  const reload = useCallback((_why) => {
    const mine = ++generation.current;
    const read = async () => {
      if (project && projects) return projects.items(project.id);
      if (!documentName) return [];
      const sheets = [];
      for (let page = 0; page < pageCount; page++) {
        const sheetId = sheetIdFor(page);
        if (sheetId) sheets.push(...(await annotations.listForSheet(sheetId)));
      }
      return sheets;
    };
    read().then(
      (items) => {
        if (mine === generation.current) setState({ items, error: null });
      },
      (cause) => {
        if (mine === generation.current) {
          setState((s) => ({ ...s, error: cause instanceof Error ? cause.message : String(cause) }));
        }
      },
    );
  }, [project, projects, annotations, documentName, pageCount, sheetIdFor]);

  // An edit on the sheet changes `changeKey`, and the list re-reads.
  useEffect(() => {
    if (active) reload(changeKey);
  }, [active, reload, changeKey]);

  useEffect(() => {
    if (!active) return undefined;
    const onReturn = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [active, reload]);

  return { ...state, reload };
}
