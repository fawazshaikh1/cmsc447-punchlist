import { useEffect, useId } from 'react';

import { Icon } from '../components/Icon';
import { useBackdropDismiss } from '../components/useBackdropDismiss';

/**
 * The frame both reversal lists open in: a wide dialog with a title, a close
 * button, Escape and a backdrop click to close — the same as Drawings.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {() => void} props.onClose
 * @param {boolean} [props.escapeCloses] False while a question is open on top
 *        of the list, so its Escape answers the question without also closing
 *        the list underneath.
 * @param {React.ReactNode} props.children
 */
export function ListDialog({ title, onClose, escapeCloses = true, children }) {
  const backdrop = useBackdropDismiss(onClose);
  const titleId = useId();

  useEffect(() => {
    if (!escapeCloses) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, escapeCloses]);

  return (
    <div className="modal-backdrop" role="presentation" {...backdrop}>
      <div
        className="modal modal-wide reversal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-heading">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
