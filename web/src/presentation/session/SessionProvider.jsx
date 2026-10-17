import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useServices } from '../ServiceContainer';
import { SessionContext, SessionStatus } from './useSession';

/** Which project each account last had open, so a reload goes straight back to it. */
const LAST_PROJECT_KEY = 'punchlist.lastProject';

function lastProjectOf(accountId) {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PROJECT_KEY) ?? '{}');
    return Number.isInteger(saved?.[accountId]) ? saved[accountId] : null;
  } catch {
    return null;
  }
}

function rememberProject(accountId, projectId) {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PROJECT_KEY) ?? '{}');
    localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({ ...saved, [accountId]: projectId }));
  } catch {
    // Private browsing or full storage: the cost is choosing the project
    // again after a reload, which is not worth an error.
  }
}

const message = (cause) => (cause instanceof Error ? cause.message : String(cause));

/**
 * Who is signed in and which project is open — and the only place either
 * changes (SCRUM-44).
 *
 * ===========================================================================
 * THE STATES
 * ===========================================================================
 *   checking         asking the server whether this browser is signed in
 *   unreachable      the server did not answer; offer to try again
 *   signedOut        show the sign-in screen
 *   choosingProject  signed in; show the projects to pick from
 *   ready            signed in, project open — the editor is shown
 *   browser          browser mode: no server, nobody signs in, straight to work
 *
 * Opening a project tells the identity provider which project it is, so the
 * actor every change is recorded under carries the right role — and that
 * happens BEFORE the editor is shown, so nothing is ever written as nobody.
 *
 * Every transition is numbered, and an answer that arrives after a newer
 * transition began is dropped. Without that, a slow project list from a
 * sign-out-then-sign-in could land on top of the new session.
 */
export function SessionProvider({ children }) {
  const value = useSessionState();
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The session's state and actions. */
function useSessionState() {
  const { accounts, projects, identity, editor } = useServices();
  const signInRequired = accounts !== null && projects !== null;

  const [state, setState] = useState(() => ({
    status: signInRequired ? SessionStatus.CHECKING : SessionStatus.BROWSER,
    account: null,
    projects: [],
    project: null,
    notice: null,
    error: null,
  }));
  const generation = useRef(0);
  // The latest state, for the focus check, which must not re-subscribe on
  // every change.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  /** Starts a transition; returns a commit that applies only if it is still the newest. */
  const begin = useCallback(() => {
    const mine = ++generation.current;
    return (next) => {
      if (mine === generation.current) setState(next);
    };
  }, []);

  /**
   * Signed in as `account`: open the wanted project if they are on it (by
   * default, the one they last had open), otherwise let them choose.
   */
  const enter = useCallback(
    async (account, wantedId = lastProjectOf(account.id), notice = null) => {
      const list = await projects.list();
      const project = list.find((p) => p.id === wantedId) ?? null;
      if (!project) {
        await identity.useProject?.(null);
        return { status: SessionStatus.CHOOSING_PROJECT, account, projects: list, project: null, notice, error: null };
      }
      await identity.useProject?.(project.id);
      rememberProject(account.id, project.id);
      return { status: SessionStatus.READY, account, projects: list, project, notice, error: null };
    },
    [projects, identity],
  );

  /** Asks the server whether this browser is signed in, and goes on from there. */
  const check = useCallback(async () => {
    if (!signInRequired) return;
    const commit = begin();
    try {
      const account = await accounts.current();
      if (!account) {
        commit({ status: SessionStatus.SIGNED_OUT, account: null, projects: [], project: null, notice: null, error: null });
        return;
      }
      commit(await enter(account));
    } catch (cause) {
      commit({ status: SessionStatus.UNREACHABLE, account: null, projects: [], project: null, notice: null, error: message(cause) });
    }
  }, [signInRequired, begin, accounts, enter]);

  useEffect(() => {
    void check();
  }, [check]);

  /** "Try again" after the server could not be reached. */
  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: SessionStatus.CHECKING, error: null }));
    return check();
  }, [check]);

  // Coming back to the tab is when a session is most likely to have ended (it
  // expired overnight) or changed (an admin changed this person's role). Check
  // then, quietly: nothing is shown unless something actually changed, and a
  // network blip is ignored rather than throwing the person out.
  useEffect(() => {
    if (!signInRequired) return undefined;

    const recheck = async () => {
      const current = latest.current;
      if (document.visibilityState !== 'visible') return;
      if (current.status !== SessionStatus.READY && current.status !== SessionStatus.CHOOSING_PROJECT) return;

      const commit = begin();
      try {
        const account = await accounts.current();
        if (!account) {
          identity.clear?.();
          commit({
            status: SessionStatus.SIGNED_OUT, account: null, projects: [], project: null,
            notice: 'Your session ended. Sign in again to carry on.', error: null,
          });
          return;
        }
        if (current.status !== SessionStatus.READY) return;

        const list = await projects.list();
        const still = list.find((p) => p.id === current.project.id);
        if (!still) {
          await identity.useProject?.(null);
          commit({
            status: SessionStatus.CHOOSING_PROJECT, account, projects: list, project: null,
            notice: `You are no longer on ${current.project.name}.`, error: null,
          });
          return;
        }
        if (still.role !== current.project.role) {
          await identity.useProject?.(still.id);
          commit({ ...current, projects: list, project: still });
        }
      } catch {
        // Unreachable for a moment: carry on, and let the next request say so.
      }
    };

    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [signInRequired, begin, accounts, projects, identity]);

  // --- actions ---------------------------------------------------------------
  // Each throws on failure, so the form that called it can show why.

  const signIn = useCallback(
    async (email, password) => {
      const commit = begin();
      const account = await accounts.signIn(email, password);
      commit(await enter(account));
    },
    [begin, accounts, enter],
  );

  const register = useCallback(
    async (details) => {
      const commit = begin();
      const account = await accounts.register(details);
      commit(await enter(account));
    },
    [begin, accounts, enter],
  );

  const signOut = useCallback(async () => {
    const commit = begin();
    let notice = null;
    try {
      await accounts.signOut();
    } catch (cause) {
      notice = `Could not reach the server to sign out, so this browser may still be signed in. ${message(cause)}`;
    }
    identity.clear?.();
    // Undo history belongs to the person who made it.
    editor.reset();
    commit({ status: SessionStatus.SIGNED_OUT, account: null, projects: [], project: null, notice, error: null });
  }, [begin, accounts, identity, editor]);

  const chooseProject = useCallback(
    async (project) => {
      const commit = begin();
      commit(await enter(latest.current.account, project.id));
    },
    [begin, enter],
  );

  const switchProject = useCallback(async () => {
    const commit = begin();
    const list = await projects.list();
    await identity.useProject?.(null);
    commit({ ...latest.current, status: SessionStatus.CHOOSING_PROJECT, projects: list, project: null, notice: null });
  }, [begin, projects, identity]);

  const createProject = useCallback(
    async (name) => {
      const commit = begin();
      const created = await projects.create(name);
      commit(await enter(latest.current.account, created.id));
    },
    [begin, projects, enter],
  );

  /**
   * Re-reads the open project — after changing your own role in the members
   * dialog, for instance. Removing yourself lands you back at the list.
   */
  const refreshProject = useCallback(async () => {
    const current = latest.current;
    if (current.status !== SessionStatus.READY) return;
    const commit = begin();
    commit(await enter(current.account, current.project.id, null));
  }, [begin, enter]);

  return useMemo(
    () => ({
      ...state,
      signInRequired,
      retry,
      signIn,
      register,
      signOut,
      chooseProject,
      switchProject,
      createProject,
      refreshProject,
    }),
    [state, signInRequired, retry, signIn, register, signOut, chooseProject, switchProject, createProject, refreshProject],
  );
}
