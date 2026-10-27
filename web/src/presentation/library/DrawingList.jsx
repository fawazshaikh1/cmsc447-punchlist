import { useCallback, useEffect, useState } from 'react';

import { canChangeLibrary } from '../../domain/library';
import { useServices } from '../ServiceContainer';
import { useConfirmation } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { useSession } from '../session/useSession';
import './library.css';

const ADDED = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The open project's drawings (FR-10.1 to 10.4) — what everyone on the
 * project, on any device, opens instead of finding the PDF again.
 *
 * Each row says who added the drawing and when (FR-10.2) and opens it with
 * one tap — the "double-click it, as in Acrobat" of FR-10.3, at tablet size.
 * An admin can also take a drawing out of the library; the markups made on it
 * are kept, and come back if it is added again.
 *
 * Read when shown, when `version` changes, and when the person comes back to
 * the tab, so a drawing a teammate added meanwhile is there without a reload.
 *
 * Renders nothing in browser mode.
 *
 * @param {object} props
 * @param {(drawing: import('../../domain/library').LibraryDrawing) => void} props.onOpen
 * @param {unknown} [props.version] Changes when the library is known to have changed.
 * @param {() => void} [props.onChanged] Called after a drawing is removed here.
 * @param {string|null} [props.openName] The drawing on screen, marked in the list.
 */
export function DrawingList({ onOpen, version, onChanged, openName = null }) {
  const { library } = useServices();
  const { project } = useSession();
  const { ask, dialog } = useConfirmation();
  const [drawings, setDrawings] = useState(null);
  const [error, setError] = useState(null);
  const [reloads, setReloads] = useState(0);
  const projectId = project?.id ?? null;

  useEffect(() => {
    if (!library || projectId === null) return undefined;
    let cancelled = false;
    const read = () => {
      library.list(projectId).then(
        (list) => {
          if (cancelled) return;
          setDrawings(list);
          setError(null);
        },
        (cause) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        },
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
  }, [library, projectId, version, reloads]);

  const remove = useCallback(
    async (drawing) => {
      const confirmed = await ask({
        title: `Remove ${drawing.name} from the project?`,
        body: (
          <p>
            Nobody will be able to open it from Drawings any more. The markups on it are kept, and come back if the
            same file is added again.
          </p>
        ),
        confirmLabel: 'Remove drawing',
        cancelLabel: 'Keep it',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        await library.remove(projectId, drawing);
        setReloads((n) => n + 1);
        onChanged?.();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [ask, library, projectId, onChanged],
  );

  if (!library || !project) return null;
  const manage = canChangeLibrary(project.role);

  return (
    <section className="drawing-library" aria-label={`Drawings in ${project.name}`}>
      {dialog}
      <h2 className="drawing-library-title">Drawings in {project.name}</h2>

      {drawings === null && !error && <p className="muted small" role="status">Loading drawings…</p>}
      {error && (
        <p className="error" role="alert">
          <Icon name="alert" size={18} /> {error}
        </p>
      )}

      {drawings && drawings.length === 0 && (
        <p className="drawing-library-empty muted">
          {manage
            ? 'No drawings yet. Use Open drawing to pick a PDF from this device — it is saved here for everyone on the project.'
            : 'No drawings yet. A project admin adds them; they appear here as soon as they do.'}
        </p>
      )}

      {drawings && drawings.length > 0 && (
        <ul className="drawing-rows">
          {drawings.map((drawing) => {
            const isOpen = drawing.name === openName;
            return (
              <li key={drawing.id} className="drawing-row">
                <button
                  type="button"
                  className={isOpen ? 'drawing-open is-current' : 'drawing-open'}
                  onClick={() => onOpen(drawing)}
                  title={isOpen ? `${drawing.name} is open` : `Open ${drawing.name}`}
                >
                  <Icon name="file" size={20} />
                  <span className="drawing-text">
                    <strong>{drawing.name}</strong>
                    <span className="muted small">
                      {[
                        drawing.sizeLabel,
                        drawing.uploadedBy && `added by ${drawing.uploadedBy}`,
                        ADDED.format(new Date(drawing.uploadedAt)),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {isOpen && <span className="drawing-current small">Open</span>}
                </button>
                {manage && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void remove(drawing)}
                    aria-label={`Remove ${drawing.name} from the project`}
                    title="Remove from the project"
                  >
                    <Icon name="trash" size={18} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
