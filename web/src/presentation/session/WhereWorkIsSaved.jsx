import { useSession } from './useSession';

/**
 * One sentence on where markups go — which differs between the two modes,
 * and was simply untrue in one of them while it was hard-coded.
 */
export function WhereWorkIsSaved() {
  const { project } = useSession();

  if (!project) {
    return <>Everything stays on this device until you export &mdash; nothing is uploaded.</>;
  }
  return (
    <>
      Markups are saved to <strong>{project.name}</strong> on the server as you go, where everyone on
      the project can see them.
    </>
  );
}
