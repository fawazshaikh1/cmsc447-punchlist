import { useEffect, useRef, useState } from 'react';

import { SheetName } from '../../domain/sheets';
import { useAutoFocus } from '../components/useAutoFocus';
import { useBackdropDismiss } from '../components/useBackdropDismiss';

/**
 * An admin correcting what a sheet is called — the fix for a title block the
 * drawing reader got wrong, or one it could not read at all. The name is kept
 * as typed and never replaced by a later reading (see SheetNames).
 *
 * Leaving both boxes empty is allowed: it gives the page back its "Sheet N".
 *
 * @param {object} props
 * @param {number} props.pageIndex The page being renamed.
 * @param {import('../../domain/sheets').SheetName|null} props.name Its current name.
 * @param {(name: { number: string, title: string }) => Promise<void>} props.onSave
 *        Rejects with the server's message when the rename is refused.
 * @param {() => void} props.onCancel
 */
export function RenameSheetDialog({ pageIndex, name, onSave, onCancel }) {
  const [number, setNumber] = useState(name?.number ?? '');
  const [title, setTitle] = useState(name?.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const numberRef = useRef(null);
  const backdrop = useBackdropDismiss(onCancel);
  useAutoFocus(numberRef);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ number: number.trim(), title: title.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" {...backdrop}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="rename-sheet-title">Rename sheet {pageIndex + 1}</h2>

        <label className="field">
          Sheet number
          <input
            ref={numberRef}
            value={number}
            maxLength={SheetName.MAX_NUMBER}
            placeholder="e.g. A-101"
            onChange={(event) => setNumber(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>

        <label className="field">
          Sheet title
          <input
            value={title}
            maxLength={SheetName.MAX_TITLE}
            placeholder="e.g. LEVEL 1 FLOOR PLAN"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
