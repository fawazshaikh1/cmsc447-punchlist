import { useContext, useEffect, useId, useRef, useState } from 'react';

import { PinStatus } from '../../domain/annotations';
import { PriorityField } from '../../domain/details';
import { STATUS_LABELS } from '../../domain/punchlist';
import { SuggestionSourcesContext } from '../components/details/SuggestionSources';
import { useAutoFocus } from '../components/useAutoFocus';
import { useBackdropDismiss } from '../components/useBackdropDismiss';
import { SheetChoice } from './SheetChoice';

/**
 * A new task, in one of two places (spec 6.4):
 *
 *   On a sheet    pick the drawing and sheet and say what needs fixing; the
 *                 sheet opens with the Pin tool armed and the description
 *                 filled in, and one tap places it.
 *   Off a sheet   for work that is not at one spot on a drawing — "order
 *                 replacement tiles". Saved straight away with its fields,
 *                 numbered G-1, G-2…, and placeable on a sheet later.
 *
 * @param {object} props
 * @param {string[]} props.drawings The project's drawings, by name.
 * @param {(documentName: string) => { pageIndex: number, label: string }[]} props.sheetsFor
 * @param {import('./SheetChoice').SheetPick|null} props.defaultSheet
 * @param {(pick: import('./SheetChoice').SheetPick & { description: string }) => void} props.onCreateOnSheet
 * @param {(fields: { description: string, status: string, priority: string, trade: string, responsibleCompany: string, assignee: string, dueDate: string }) => Promise<void>} props.onCreateOffSheet
 * @param {() => void} props.onCancel
 */
export function NewTaskDialog({ drawings, sheetsFor, defaultSheet, onCreateOnSheet, onCreateOffSheet, onCancel }) {
  const ids = useId();
  const people = useContext(SuggestionSourcesContext).people ?? [];
  const [where, setWhere] = useState(defaultSheet ? 'on' : 'off');
  const [description, setDescription] = useState('');
  const [sheet, setSheet] = useState(defaultSheet ?? { documentName: '', pageIndex: 0 });
  const [fields, setFields] = useState({
    status: PinStatus.OPEN,
    priority: PriorityField.DEFAULT,
    trade: '',
    responsibleCompany: '',
    assignee: '',
    dueDate: '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const descriptionRef = useRef(null);
  const backdrop = useBackdropDismiss(onCancel);
  useAutoFocus(descriptionRef);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const set = (key) => (event) => setFields((previous) => ({ ...previous, [key]: event.target.value }));

  const create = async () => {
    const text = description.trim();
    if (!text) {
      setError('Say what needs doing — whoever picks it up needs to know what they are looking at.');
      return;
    }
    if (where === 'on') {
      onCreateOnSheet({ ...sheet, description: text });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreateOffSheet({ ...fields, description: text });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" {...backdrop}>
      <div
        className="modal modal-wide new-task"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={`${ids}-title`}>New task</h2>

        <div className="new-task-where" role="radiogroup" aria-label="Where the task is">
          <label className={where === 'on' ? 'choice active' : 'choice'}>
            <input
              type="radio"
              name={`${ids}-where`}
              checked={where === 'on'}
              disabled={!defaultSheet}
              onChange={() => setWhere('on')}
            />
            <span className="choice-title">On a sheet</span>
            <span className="choice-hint">Pick the sheet, then tap the spot on it.</span>
          </label>
          <label className={where === 'off' ? 'choice active' : 'choice'}>
            <input type="radio" name={`${ids}-where`} checked={where === 'off'} onChange={() => setWhere('off')} />
            <span className="choice-title">Off a sheet</span>
            <span className="choice-hint">For work that is not at one spot on a drawing. Place it on a sheet later.</span>
          </label>
        </div>

        <label className="field">
          What needs doing?
          <textarea
            ref={descriptionRef}
            rows={2}
            value={description}
            placeholder="e.g. Fire door closer missing at stair 2"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        {where === 'on' ? (
          <SheetChoice drawings={drawings} sheetsFor={sheetsFor} value={sheet} onChange={setSheet} />
        ) : (
          <div className="new-task-fields">
            <label className="field">
              Status
              <select value={fields.status} onChange={set('status')}>
                {Object.values(PinStatus).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Priority
              <select value={fields.priority} onChange={set('priority')}>
                {new PriorityField().getChoices().map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Trade
              <input value={fields.trade} placeholder="e.g. Electrical" onChange={set('trade')} />
            </label>
            <label className="field">
              Responsible company
              <input value={fields.responsibleCompany} placeholder="e.g. Rivera Electric" onChange={set('responsibleCompany')} />
            </label>
            <label className="field">
              Assigned to
              <input value={fields.assignee} list={`${ids}-people`} placeholder="Optional" onChange={set('assignee')} />
              <datalist id={`${ids}-people`}>
                {people.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label className="field">
              Due date
              <input type="date" value={fields.dueDate} onChange={set('dueDate')} />
            </label>
          </div>
        )}

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={saving} onClick={() => void create()}>
            {where === 'on' ? 'Go to the sheet' : saving ? 'Saving…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  );
}
