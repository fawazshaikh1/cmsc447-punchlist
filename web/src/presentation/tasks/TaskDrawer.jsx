import { useEffect, useState } from 'react';

import { PinStatus } from '../../domain/annotations';
import { STATUS_LABELS } from '../../domain/punchlist';
import { useConfirmation } from '../components/ConfirmDialog';
import { ItemDetailsEditor } from '../components/details';
import { useCommitOnBlur } from '../components/useCommitOnBlur';
import { useServices } from '../ServiceContainer';

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * One task, opened from the Tasks tab (spec 6.1, 6.5, 6.7): every field,
 * editable by whoever may edit it, its whole history, and the way to its
 * sheet — or onto one, for a task that is not on a drawing yet.
 *
 * Every edit goes through the same EditorService as the sheet's side panel,
 * so roles, the issue lock, the required description and the history all
 * apply with no second code path. An issued task shows read-only, with why.
 *
 * @param {object} props
 * @param {import('../../domain/tasks/taskRows').TaskRow} props.row
 * @param {import('../../domain/annotations').Annotation[]} props.peers Other
 *        tasks, for the fields' suggestions.
 * @param {(previous, next, label: string) => Promise<void>} props.onSave
 * @param {() => void} props.onClose
 * @param {(row) => void} props.onOpenOnSheet
 * @param {((row) => void)|undefined} props.onPlace Offered for a task off the
 *        drawings, to someone who may place it.
 * @param {number} props.revision Changes after every save, so the history re-reads.
 * @param {React.ReactNode} [props.children] More sections — comments.
 */
export function TaskDrawer({ row, peers, onSave, onClose, onOpenOnSheet, onPlace, revision, children }) {
  const { editor, tasks } = useServices();
  const { ask, dialog } = useConfirmation();
  // Filed under the task and revision it was read for, so a different task
  // shows "Loading…" rather than the last one's history.
  const [loaded, setLoaded] = useState({ key: null, records: [] });
  const historyKey = `${row.id}:${revision}`;
  const history = loaded.key === historyKey ? loaded.records : null;
  const annotation = row.annotation;
  const lock = editor.canEdit(annotation);
  const readOnly = lock.denied;

  const description = useCommitOnBlur(
    annotation.label,
    (next) => void onSave(annotation, annotation.withLabel(next), 'Describe'),
    annotation.id,
  );

  useEffect(() => {
    let live = true;
    tasks.historyFor(row.id).then(
      (records) => live && setLoaded({ key: historyKey, records }),
      () => live && setLoaded({ key: historyKey, records: [] }),
    );
    return () => {
      live = false;
    };
  }, [tasks, row.id, historyKey]);

  const changeStatus = async (next) => {
    if (next === PinStatus.CLOSED && annotation.status !== PinStatus.CLOSED) {
      const confirmed = await ask({
        title: 'Close this task?',
        body: <p>Closing says the work is done and checked. It can still be reopened until the drawing is issued.</p>,
        confirmLabel: 'Close task',
        cancelLabel: 'Not yet',
      });
      if (!confirmed) return;
    }
    await onSave(annotation, annotation.withStatus(next), 'Set status of');
  };

  return (
    <aside className="task-drawer" aria-label={`Task ${row.number}`}>
      {dialog}
      <header className="task-drawer-head">
        <span className={`task-number status-${row.statusKey}`}>{row.number}</span>
        <span className="task-drawer-where">
          {row.isOffSheet ? 'Not on a sheet' : `${row.sheetLabel} — ${row.documentName}`}
        </span>
        <button type="button" className="task-drawer-close" onClick={onClose} aria-label="Close the task">
          ×
        </button>
      </header>

      {readOnly && <p className="notice small">{lock.reason}</p>}

      <label className="field">
        Description
        <textarea
          rows={3}
          defaultValue={annotation.label}
          key={`${annotation.id}:${annotation.label}`}
          readOnly={readOnly}
          onChange={description.onChange}
          onBlur={description.onBlur}
        />
      </label>

      <label className="field">
        Status
        <select value={annotation.status} disabled={readOnly} onChange={(event) => void changeStatus(event.target.value)}>
          {Object.values(PinStatus).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>

      <ItemDetailsEditor annotation={annotation} readOnly={readOnly} onUpdate={onSave} peers={peers} />

      <div className="task-drawer-actions">
        {row.isOffSheet ? (
          onPlace && (
            <button type="button" className="btn" onClick={() => onPlace(row)}>
              Place on a sheet
            </button>
          )
        ) : (
          <button type="button" className="btn" onClick={() => onOpenOnSheet(row)}>
            Open on sheet
          </button>
        )}
      </div>

      {children}

      <section className="task-history" aria-label="History">
        <h3 className="details-title">History</h3>
        {history === null ? (
          <p className="muted small">Loading…</p>
        ) : history.length === 0 ? (
          <p className="muted small">No changes recorded yet.</p>
        ) : (
          <ol className="task-history-list">
            {history.map((record) => (
              <li key={record.id}>
                <span>
                  {record.describe()}
                  {record.detail && record.intent !== 'comment' ? ` — ${record.detail}` : ''}
                </span>
                <time className="muted small" dateTime={record.at}>
                  {WHEN.format(new Date(record.at))}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
