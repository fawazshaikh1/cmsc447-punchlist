import { useContext, useEffect, useMemo, useState } from 'react';

import { PIN_KIND } from '../../domain/annotations';
import { planCarryForward } from '../../domain/revisions';
import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';
import { useSheetIdentity } from '../session/useSheetIdentity';

/**
 * Carrying open items forward when a revised set is opened (SCRUM-91, D7).
 *
 * When the drawing on screen replaces an earlier one, the earlier set's open
 * items are matched to this one's sheets by number (planCarryForward). The
 * match waits for this drawing's sheet numbers, which are read from its title
 * blocks the first time an admin or power collaborator opens it. Moving is
 * offered, not automatic: the items move as one undoable step through the
 * editor, so it is checked, recorded and can be taken back.
 *
 * The project's seals are read here, not taken from the editor: the editor
 * only knows the seals of the sheet that is open — the revision, which has
 * none yet — so without them an issued item on the old set would move.
 *
 * Offered to those who may move items — admins and power collaborators.
 *
 * @param {object} options
 * @param {string|null} options.documentName The drawing on screen, or null.
 * @param {(documentName: string) => import('../../domain/sheets').SheetName[]} options.namedSheets
 * @param {unknown} options.version useLibrary's `version`.
 * @param {() => void} options.onCarried After items moved — the sheet re-reads.
 */
export function useCarryForward({ documentName, namedSheets, version, onCarried }) {
  const { revisions, library, projects, tasks, editor } = useServices();
  const project = useContext(SessionContext)?.project ?? null;
  const sheetIdOf = useSheetIdentity();
  const [round, setRound] = useState(0);
  const [found, setFound] = useState({ key: null, previous: null, items: [], sealed: new Set() });
  const [dismissed, setDismissed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const key = `${project?.id}:${documentName}:${String(version)}:${round}`;
  useEffect(() => {
    if (!revisions || !library || !projects || !project || !documentName) return undefined;
    let live = true;
    (async () => {
      const [drawings, links] = await Promise.all([library.list(project.id), revisions.list(project.id)]);
      const current = drawings.find((drawing) => drawing.name === documentName);
      const link = current ? links.find((each) => each.documentId === current.id) : null;
      const previous = link ? drawings.find((drawing) => drawing.id === link.revisionOf) ?? null : null;
      const [items, sealed] = previous
        ? await Promise.all([projects.items(project.id), tasks ? tasks.sealedIds(project.id) : new Set()])
        : [[], new Set()];
      if (live) setFound({ key, previous, items, sealed });
    })().catch(() => live && setFound({ key, previous: null, items: [], sealed: new Set() }));
    return () => {
      live = false;
    };
  }, [revisions, library, projects, tasks, project, documentName, key]);

  const previous = found.key === key ? found.previous : null;
  const toSheets = useMemo(() => (documentName ? namedSheets(documentName) : []), [documentName, namedSheets]);
  const plan = useMemo(
    () =>
      previous && documentName
        ? planCarryForward({
            items: found.items,
            fromDocument: previous.name,
            toDocument: documentName,
            fromSheets: namedSheets(previous.name),
            toSheets,
            sheetIdFor: sheetIdOf,
            sealedIds: found.sealed,
          })
        : null,
    [previous, documentName, found.items, found.sealed, namedSheets, toSheets, sheetIdOf],
  );

  const mayCarry = editor.canCreate(PIN_KIND).allowed;
  const worthSaying = Boolean(plan && (plan.moves.length > 0 || plan.left.length > 0));
  const visible =
    Boolean(message) || (mayCarry && worthSaying && toSheets.length > 0 && dismissed !== documentName);

  const carry = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const { applied, skipped } = await editor.applyAll(plan.moves, 'Carry forward');
      const stayed = plan.left.length + skipped.length;
      setMessage({
        tone: skipped.length > 0 ? 'error' : 'ok',
        text:
          `Moved ${applied.length} item${applied.length === 1 ? '' : 's'} to ${documentName}, each flagged to check its place.` +
          (stayed > 0
            ? ` ${stayed} stayed on ${previous.name}: ${[...new Set([...plan.left.map(({ reason }) => reason), ...skipped.map(({ reason }) => reason)])].join(' ')}`
            : ''),
      });
      setRound((n) => n + 1);
      onCarried?.();
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setDismissed(documentName);
    setMessage(null);
  };

  return { visible, previous, plan, busy, message, carry, dismiss };
}
