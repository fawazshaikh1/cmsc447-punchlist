import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';

import { useServices } from '../ServiceContainer';
import { Icon } from '../components/Icon';
import { useBackdropDismiss } from '../components/useBackdropDismiss';
import { useSession } from '../session/useSession';
import { DrawingList } from './DrawingList';

/**
 * "Drawings" in the top bar: the project's library while a drawing is open,
 * so moving to another sheet set never means finding a PDF on this device.
 *
 * The dialog is portalled to the end of the page for the same reason as the
 * session menu's: the top bar is its own stacking context, beneath the panel.
 *
 * Renders nothing in browser mode.
 *
 * @param {object} props
 * @param {(drawing: import('../../domain/library').LibraryDrawing) => void} props.onOpen
 * @param {unknown} [props.version] See DrawingList.
 * @param {() => void} [props.onChanged] See DrawingList.
 * @param {string|null} [props.openName] The drawing on screen.
 */
export function LibraryButton({ onOpen, version, onChanged, openName }) {
  const { library } = useServices();
  const { project } = useSession();
  const [open, setOpen] = useState(false);

  if (!library || !project) return null;

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} title={`Drawings in ${project.name}`}>
        <Icon name="layers" size={18} />
        <span className="btn-label">Drawings</span>
      </button>
      {open &&
        createPortal(
          <LibraryDialog
            onClose={() => setOpen(false)}
            onOpen={(drawing) => {
              setOpen(false);
              onOpen(drawing);
            }}
            version={version}
            onChanged={onChanged}
            openName={openName}
          />,
          document.body,
        )}
    </>
  );
}

function LibraryDialog({ onClose, onOpen, version, onChanged, openName }) {
  const backdrop = useBackdropDismiss(onClose);
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" {...backdrop}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-heading">
          <h2 id={titleId}>Open a drawing</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <DrawingList onOpen={onOpen} version={version} onChanged={onChanged} openName={openName} />
      </div>
    </div>
  );
}
