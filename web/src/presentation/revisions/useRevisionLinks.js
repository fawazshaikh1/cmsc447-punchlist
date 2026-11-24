import { useCallback, useContext, useEffect, useState } from 'react';

import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';

/**
 * Which drawing replaces which in the open project (SCRUM-90), read again when
 * the library changes and after a revision is uploaded.
 *
 * @param {unknown} version useLibrary's `version`.
 * @returns {{ links: import('../../domain/revisions').RevisionLink[], reload: () => void }}
 */
export function useRevisionLinks(version) {
  const { revisions } = useServices();
  const projectId = useContext(SessionContext)?.project?.id ?? null;
  const [round, setRound] = useState(0);
  const [links, setLinks] = useState([]);

  useEffect(() => {
    if (!revisions || projectId === null) return undefined;
    let live = true;
    revisions.list(projectId).then(
      (list) => live && setLinks(list),
      () => live && setLinks([]),
    );
    return () => {
      live = false;
    };
  }, [revisions, projectId, version, round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { links, reload };
}
