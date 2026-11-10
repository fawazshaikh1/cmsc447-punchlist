import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { buildTaskRows } from '../../domain/tasks';
import { currentFlagContext } from '../flags/flagContext';
import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';

/**
 * Every task in the open project, as the Tasks tab's rows (spec 6.2).
 *
 * One read of the project's markups, its locks and its latest changes, made
 * when the tab opens, after every edit made in it, and when the person comes
 * back to the browser tab — so a teammate's work appears without a reload.
 *
 * The locks also go into ActiveSeals, the same set the sheet editor fills
 * for one sheet: while this tab is open every drawing's seals apply, so an
 * issued task here is read-only exactly as it is on its sheet (spec 6.5).
 *
 * @param {object} options
 * @param {boolean} options.active Whether the tab is on screen; it reads only then.
 * @param {(documentName: string, pageIndex: number) => string} options.sheetLabelFor
 * @returns {{ rows: import('../../domain/tasks/taskRows').TaskRow[]|null, annotations: import('../../domain/annotations').Annotation[], error: string|null, reload: () => void }}
 */
export function useTasks({ active, sheetLabelFor }) {
  const { projects, tasks, activeSeals } = useServices();
  const project = useContext(SessionContext)?.project ?? null;
  const [data, setData] = useState({ annotations: null, sealed: new Set(), latest: new Map(), error: null });
  const generation = useRef(0);

  const reload = useCallback(() => {
    if (!project || !projects || !tasks) return;
    const mine = ++generation.current;
    Promise.all([projects.items(project.id), tasks.sealedIds(project.id), tasks.latestChanges(project.id)]).then(
      ([annotations, sealed, latest]) => {
        if (mine !== generation.current) return;
        activeSeals.replace(sealed);
        setData({ annotations, sealed, latest, error: null });
      },
      (cause) => {
        if (mine !== generation.current) return;
        setData((previous) => ({ ...previous, error: cause instanceof Error ? cause.message : String(cause) }));
      },
    );
  }, [project, projects, tasks, activeSeals]);

  useEffect(() => {
    if (active) reload();
  }, [active, reload]);

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

  const rows = useMemo(
    () =>
      data.annotations
        ? buildTaskRows(data.annotations, {
            today: currentFlagContext().today,
            sheetLabelFor,
            sealedIds: data.sealed,
            lastChanges: data.latest,
          })
        : null,
    [data, sheetLabelFor],
  );

  return { rows, annotations: data.annotations ?? [], error: data.error, reload };
}
