import { createContext, useContext } from 'react';

/**
 * Suggestions the app knows about at run time, by the name a field asks for
 * (see ItemField.getSuggestionSource) — today, 'people': the open project's
 * members. Provided by the session; empty in browser mode, where there is no
 * project, and in any tree that provides nothing.
 *
 * @type {import('react').Context<Record<string, string[]>>}
 */
export const SuggestionSourcesContext = createContext({});

/** @param {string|null} name @returns {string[]} */
export function useSuggestionSource(name) {
  const sources = useContext(SuggestionSourcesContext);
  return (name && sources[name]) || [];
}
