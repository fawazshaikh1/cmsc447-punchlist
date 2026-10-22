import { createContext, useContext, useMemo } from 'react';

import { SheetScope } from '../../domain/projects';

/**
 * Where the app is in signing in: nobody yet, choosing a project, or working.
 *
 * `BROWSER` is the whole of browser mode — there is nothing to sign in to, so
 * the app goes straight to work, anonymously, with sheets named as they always
 * were.
 */
export const SessionStatus = Object.freeze({
  BROWSER: 'browser',
  CHECKING: 'checking',
  UNREACHABLE: 'unreachable',
  SIGNED_OUT: 'signedOut',
  CHOOSING_PROJECT: 'choosingProject',
  READY: 'ready',
});

/** The session — see SessionProvider for its shape. */
export const SessionContext = createContext(null);

/**
 * The session: who is signed in, which project is open, and the actions that
 * change either. See SessionProvider.
 */
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession() must be called inside a <SessionProvider>.');
  return session;
}

/**
 * How sheets are named right now — inside the open project, or (browser mode,
 * or outside any provider) exactly as before projects existed.
 *
 * Memoised on the project id: a new scope object on every render would give
 * every callback built from it a new identity, and re-run every effect that
 * depends on the sheet id.
 *
 * @returns {SheetScope}
 */
export function useSheetScope() {
  const session = useContext(SessionContext);
  const projectId = session?.project?.id ?? null;
  return useMemo(
    () => (projectId === null ? SheetScope.NONE : SheetScope.forProject(projectId)),
    [projectId],
  );
}
