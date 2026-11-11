import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';

/**
 * The signed-in person's starred sheets in the open project (spec 7.2), the
 * same on every device they use.
 *
 * Starring shows at once and is put back if the server refuses — a star that
 * lights and then goes dark says what happened better than one that waits.
 *
 * @returns {{ available: boolean, ids: string[], isStarred: (sheetId: string) => boolean, toggle: (sheetId: string) => Promise<void>, error: string|null }}
 */
export function useBookmarks() {
  const { bookmarks } = useServices();
  const project = useContext(SessionContext)?.project ?? null;
  const projectId = project?.id ?? null;
  const [state, setState] = useState({ projectId: null, ids: [], error: null });

  useEffect(() => {
    if (!bookmarks || projectId === null) return undefined;
    let live = true;
    bookmarks.list(projectId).then(
      (ids) => live && setState({ projectId, ids, error: null }),
      (cause) => live && setState({ projectId, ids: [], error: messageOf(cause) }),
    );
    return () => {
      live = false;
    };
  }, [bookmarks, projectId]);

  const ids = useMemo(() => (state.projectId === projectId ? state.ids : []), [state, projectId]);

  const toggle = useCallback(
    async (sheetId) => {
      if (!bookmarks || projectId === null || !sheetId) return;
      const starred = ids.includes(sheetId);
      const next = starred ? ids.filter((id) => id !== sheetId) : [...ids, sheetId];
      setState({ projectId, ids: next, error: null });
      try {
        if (starred) await bookmarks.remove(projectId, sheetId);
        else await bookmarks.add(projectId, sheetId);
      } catch (cause) {
        setState({ projectId, ids, error: messageOf(cause) });
      }
    },
    [bookmarks, projectId, ids],
  );

  return {
    available: Boolean(bookmarks && projectId !== null),
    ids,
    isStarred: (sheetId) => ids.includes(sheetId),
    toggle,
    error: state.projectId === projectId ? state.error : null,
  };
}

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
