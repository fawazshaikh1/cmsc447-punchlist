import { useEffect, useMemo, useState } from 'react';

import { useServices } from '../ServiceContainer';
import { SuggestionSourcesContext } from '../components/details/SuggestionSources';

/**
 * The open project's people, offered wherever a field asks for 'people' —
 * "Assigned to" first of all (SCRUM-32). Picking a teammate from the list
 * spells their name exactly as "Assigned to me" matches it.
 *
 * Read when the project opens and again when the person comes back to the
 * tab, so someone an admin added meanwhile is offered without a reload. A
 * failed read offers nothing rather than an error: suggestions are a
 * convenience, and the field still takes any name.
 *
 * @param {object} props
 * @param {number} props.projectId
 * @param {React.ReactNode} props.children
 */
export function ProjectPeople({ projectId, children }) {
  const { projects } = useServices();
  const [names, setNames] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      projects.members(projectId).then(
        (members) => {
          if (!cancelled) setNames(members.map((member) => member.displayName));
        },
        () => {},
      );
    };
    read();
    const onReturn = () => {
      if (document.visibilityState === 'visible') read();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [projects, projectId]);

  const sources = useMemo(() => ({ people: names }), [names]);
  return <SuggestionSourcesContext.Provider value={sources}>{children}</SuggestionSourcesContext.Provider>;
}
