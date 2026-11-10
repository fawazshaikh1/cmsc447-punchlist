import { useEffect, useId, useState } from 'react';

import { useBackdropDismiss } from '../components/useBackdropDismiss';
import { SheetChoice } from './SheetChoice';

/**
 * Puts a task that was off the drawings onto a sheet (spec 6.4). It keeps its
 * id, description, fields, history and comments; it becomes the sheet's next
 * pin. It lands near the sheet's corner, selected, for the person to drag to
 * the exact spot — the Tasks tab does not have the drawing in front of it.
 *
 * @param {object} props
 * @param {import('../../domain/tasks/taskRows').TaskRow} props.row
 * @param {string[]} props.drawings
 * @param {(documentName: string) => { pageIndex: number, label: string }[]} props.sheetsFor
 * @param {import('./SheetChoice').SheetPick} props.defaultSheet
 * @param {(pick: import('./SheetChoice').SheetPick) => Promise<void>} props.onPlace
 * @param {() => void} props.onCancel
 */
export function PlaceTaskDialog({ row, drawings, sheetsFor, defaultSheet, onPlace, onCancel }) {
  const ids = useId();
  const [sheet, setSheet] = useState(defaultSheet);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const backdrop = useBackdropDismiss(onCancel);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const place = async () => {
    setSaving(true);
    setError(null);
    try {
      await onPlace(sheet);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" {...backdrop}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${ids}-title`}>Place {row.number} on a sheet</h2>
        <p className="modal-hint">
          {row.description} — it keeps its fields, history and comments, and lands near the sheet&rsquo;s corner,
          selected, for you to drag to the right spot.
        </p>
        <SheetChoice drawings={drawings} sheetsFor={sheetsFor} value={sheet} onChange={setSheet} />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={saving || !sheet.documentName} onClick={() => void place()}>
            {saving ? 'Placing…' : 'Place on sheet'}
          </button>
        </div>
      </div>
    </div>
  );
}
