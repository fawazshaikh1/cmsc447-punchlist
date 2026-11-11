import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { OffSheetTask, PIN_KIND, PinStatus, TASK_KIND } from '../../domain/annotations';
import { PriorityField } from '../../domain/details';
import { PdfPoint } from '../../domain/geometry/PdfPoint';
import { STATUS_LABELS, TaskFilter } from '../../domain/punchlist';
import {
  OFF_SHEET_DOCUMENT,
  TaskGroupRegistry,
  TaskSortRegistry,
  filterTaskRows,
  groupTaskRows,
  sortTaskRows,
  taskCsv,
} from '../../domain/tasks';
import { useConfirmation } from '../components/ConfirmDialog';
import { useServices } from '../ServiceContainer';
import { SessionContext } from '../session/useSession';
import { useSheetIdentity } from '../session/useSheetIdentity';
import { BulkBar } from './BulkBar';
import { downloadText } from './downloadText';
import { NewTaskDialog } from './NewTaskDialog';
import { PlaceTaskDialog } from './PlaceTaskDialog';
import { TaskDrawer } from './TaskDrawer';
import { useTasks } from './useTasks';
import './tasks.css';

/** Where a task placed from this tab lands: an inch in from the corner, to be dragged into place. */
const PLACE_AT = new PdfPoint(72, 72);

const DUE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const UPDATED = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const STATUS_CHOICES = [
  [TaskFilter.ANY, 'Any status'],
  [TaskFilter.OUTSTANDING, 'Still to do'],
  [TaskFilter.OVERDUE, 'Overdue'],
  ...Object.values(PinStatus).map((status) => [status, STATUS_LABELS[status]]),
];

const NO_FILTERS = Object.freeze({ status: TaskFilter.ANY, priority: '', company: '', trade: '', mine: false, query: '' });

/**
 * The Tasks tab (spec 6): every task in the project in one list, like
 * Fieldwire's — searched, filtered, sorted and grouped (by sheet unless asked
 * otherwise), opened in a panel, created on a sheet or off one, edited in
 * bulk, and exported to CSV.
 *
 * Holds no rule of its own. What a row is, and what each sort, group and
 * filter means, are in domain/tasks; who may change what is EditorService's
 * policy, the same one the sheet uses.
 *
 * @param {object} props
 * @param {(documentName: string, pageIndex: number) => string} props.sheetLabelFor
 * @param {(documentName: string) => { pageIndex: number, label: string }[]} props.sheetsFor
 * @param {import('./SheetChoice').SheetPick|null} props.openSheet The sheet
 *        on screen in the Sheets view, offered first for a new task.
 * @param {(target: { documentName: string, pageIndex: number, annotationId?: string }) => void} props.onOpenOnSheet
 * @param {(target: import('./SheetChoice').SheetPick & { description: string }) => void} props.onCreateOnSheet
 * @param {React.ReactNode} [props.adminTools] More views for admins.
 * @param {(row) => React.ReactNode} [props.renderTaskExtras] More sections in
 *        a task's panel — comments.
 */
export function TasksView({ sheetLabelFor, sheetsFor, openSheet, onOpenOnSheet, onCreateOnSheet, renderTaskExtras }) {
  const { editor, annotations: annotationService, library } = useServices();
  const session = useContext(SessionContext);
  const project = session?.project ?? null;
  const account = session?.account ?? null;
  const sheetIdOf = useSheetIdentity();
  const { ask, dialog: confirmDialog } = useConfirmation();
  const { rows, annotations, error, reload } = useTasks({ active: true, sheetLabelFor });

  const [filters, setFilters] = useState({ ...NO_FILTERS, status: TaskFilter.OUTSTANDING });
  const [sortKey, setSortKey] = useState('sheet');
  const [groupKey, setGroupKey] = useState('sheet');
  const [ticked, setTicked] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [revision, setRevision] = useState(0);
  const [drawings, setDrawings] = useState([]);

  const mayEdit = editor.canCreate(PIN_KIND).allowed;
  const mayCreateTask = editor.canCreate(TASK_KIND).allowed;

  useEffect(() => {
    if (!library || !project) return;
    let live = true;
    library.list(project.id).then(
      (list) => live && setDrawings(list.map((drawing) => drawing.name)),
      () => live && setDrawings([]),
    );
    return () => {
      live = false;
    };
  }, [library, project]);

  const drawingNames = useMemo(() => {
    const names = [...drawings];
    if (openSheet?.documentName && !names.includes(openSheet.documentName)) names.unshift(openSheet.documentName);
    return names;
  }, [drawings, openSheet]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const filtered = filterTaskRows(rows, { ...filters, assignedTo: filters.mine && account ? account.displayName : null });
    return sortTaskRows(filtered, sortKey);
  }, [rows, filters, account, sortKey]);
  const groups = useMemo(() => groupTaskRows(shown, groupKey), [shown, groupKey]);
  const options = useMemo(() => distinctOptions(rows ?? []), [rows]);
  const openRow = rows?.find((row) => row.id === openId) ?? null;
  const tickedRows = shown.filter((row) => ticked.has(row.id));

  const total = rows?.length ?? 0;
  const overdue = rows?.filter((row) => row.isOverdue).length ?? 0;
  const filtered = JSON.stringify({ ...filters }) !== JSON.stringify({ ...NO_FILTERS });

  const afterEdit = useCallback(() => {
    reload();
    setRevision((n) => n + 1);
  }, [reload]);

  const save = useCallback(
    async (previous, next, label) => {
      try {
        await editor.update(previous, next, label);
        setNotice(null);
      } catch (cause) {
        setNotice({ tone: 'error', text: messageOf(cause) });
      }
      afterEdit();
    },
    [editor, afterEdit],
  );

  // The same undo as the sheet's: one history, whichever view made the change.
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      void (event.shiftKey ? editor.redo() : editor.undo()).then(afterEdit);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editor, afterEdit]);

  const applyBulk = async (changesFor, label) => {
    const changes = [];
    const refused = [];
    for (const row of tickedRows) {
      try {
        const next = changesFor(row);
        if (next !== row.annotation) changes.push({ previous: row.annotation, next });
      } catch (cause) {
        refused.push(`${row.number}: ${messageOf(cause)}`);
      }
    }
    const { applied, skipped } = await editor.applyAll(changes, label);
    const numberOf = (id) => rows.find((row) => row.id === id)?.number ?? '?';
    const notChanged = [...skipped.map(({ annotation }) => numberOf(annotation.id)), ...refused.map((text) => text.split(':')[0])];
    setNotice({
      tone: notChanged.length ? 'error' : 'ok',
      text:
        `${applied.length} task${applied.length === 1 ? '' : 's'} changed.` +
        (notChanged.length
          ? ` ${notChanged.length} not changed (${notChanged.join(', ')}): ${skipped[0]?.reason ?? refused[0]}`
          : ''),
    });
    setTicked(new Set());
    afterEdit();
  };

  const deleteTicked = async () => {
    const confirmed = await ask({
      title: `Delete ${tickedRows.length} task${tickedRows.length === 1 ? '' : 's'}?`,
      body: <p>They can be brought back with Undo straight away.</p>,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep them',
      tone: 'danger',
    });
    if (confirmed) await applyBulk(() => null, `Delete ${tickedRows.length} task(s)`);
  };

  const createOffSheet = async ({ description, status, ...details }) => {
    let task = new OffSheetTask(
      annotationService.ids.next(),
      sheetIdOf(OFF_SHEET_DOCUMENT, 0),
      description,
      status,
      new Date(),
    );
    for (const [key, value] of Object.entries(details)) if (value) task = task.withDetail(key, value);
    await editor.add(task);
    setDialog(null);
    setOpenId(task.id);
    setNotice({ tone: 'ok', text: 'Task created, off the drawings. Place it on a sheet from its panel when you know where it is.' });
    afterEdit();
  };

  const place = async (row, { documentName, pageIndex }) => {
    const next = row.annotation.placedAt(sheetIdOf(documentName, pageIndex), PLACE_AT);
    const { skipped } = await editor.applyAll([{ previous: row.annotation, next }], 'Place on sheet');
    if (skipped.length > 0) throw new Error(skipped[0].reason);
    setDialog(null);
    onOpenOnSheet({ documentName, pageIndex, annotationId: row.id });
  };

  const exportCsv = () => {
    const name = (project?.name ?? 'Project').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    downloadText(taskCsv(shown), `${name} tasks.csv`, 'text/csv;charset=utf-8');
  };

  const set = (key) => (event) => setFilters((previous) => ({ ...previous, [key]: event.target.value }));
  const toggle = (id) =>
    setTicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allTicked = shown.length > 0 && shown.every((row) => ticked.has(row.id));
  const defaultSheet = openSheet?.documentName
    ? openSheet
    : drawingNames[0]
      ? { documentName: drawingNames[0], pageIndex: sheetsFor(drawingNames[0])[0]?.pageIndex ?? 0 }
      : null;

  return (
    <div className={openRow ? 'tasks-view with-drawer' : 'tasks-view'}>
      {confirmDialog}
      <section className="tasks-main" aria-label="Tasks">
        <div className="tasks-toolbar">
          <input
            type="search"
            className="tasks-search"
            placeholder="Search tasks"
            aria-label="Search tasks"
            value={filters.query}
            onChange={set('query')}
          />
          <select aria-label="Status" value={filters.status} onChange={set('status')}>
            {STATUS_CHOICES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select aria-label="Priority" value={filters.priority} onChange={set('priority')}>
            <option value="">Any priority</option>
            {PriorityField.LEVELS.map((level) => (
              <option key={level} value={level}>
                {PriorityField.LABELS[level]}
              </option>
            ))}
          </select>
          <select aria-label="Company" value={filters.company} onChange={set('company')}>
            <option value="">Any company</option>
            {options.companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
          <select aria-label="Trade" value={filters.trade} onChange={set('trade')}>
            <option value="">Any trade</option>
            {options.trades.map((trade) => (
              <option key={trade} value={trade}>
                {trade}
              </option>
            ))}
          </select>
          {account && (
            <label className="tasks-mine">
              <input
                type="checkbox"
                checked={filters.mine}
                onChange={(event) => setFilters((previous) => ({ ...previous, mine: event.target.checked }))}
              />
              Assigned to me
            </label>
          )}
          <span className="tasks-toolbar-gap" />
          <label className="tasks-order">
            Sort
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
              {TaskSortRegistry.all().map((sort) => (
                <option key={sort.key} value={sort.key}>
                  {sort.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tasks-order">
            Group
            <select value={groupKey} onChange={(event) => setGroupKey(event.target.value)}>
              {TaskGroupRegistry.all().map((grouping) => (
                <option key={grouping.key} value={grouping.key}>
                  {grouping.label}
                </option>
              ))}
              <option value="none">None</option>
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={!editor.canUndo()}
            title={editor.canUndo() ? `Undo: ${editor.peekUndo()}` : 'Nothing to undo'}
            onClick={() => void editor.undo().then(afterEdit)}
          >
            Undo
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={shown.length === 0}>
            Export CSV
          </button>
          {mayCreateTask && (
            <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'new' })}>
              New task
            </button>
          )}
        </div>

        <p className="tasks-summary muted small" role="status">
          {rows === null
            ? 'Loading the tasks…'
            : `${filtered ? `${shown.length} of ${total}` : total} task${total === 1 ? '' : 's'}` +
              (overdue ? ` · ${overdue} overdue` : '')}
          {filtered && (
            <button type="button" className="punch-clear" onClick={() => setFilters({ ...NO_FILTERS })}>
              Show all
            </button>
          )}
        </p>

        {error && <p className="error">{error}</p>}
        {notice && (
          <p className={notice.tone === 'error' ? 'error tasks-notice' : 'notice tasks-notice'} role="status">
            {notice.text}
          </p>
        )}

        {mayEdit && tickedRows.length > 0 && (
          <BulkBar
            count={tickedRows.length}
            onApply={(transform, label) => void applyBulk((row) => transform(row.annotation), label)}
            onDelete={() => void deleteTicked()}
            onClear={() => setTicked(new Set())}
          />
        )}

        {rows !== null && total === 0 && (
          <p className="tasks-empty muted">
            No tasks yet. Place a pin on a sheet{mayCreateTask ? ', or use New task' : ''} to raise one.
          </p>
        )}
        {rows !== null && total > 0 && shown.length === 0 && <p className="tasks-empty muted">Nothing matches these filters.</p>}

        {shown.length > 0 && (
          <div className="task-table" role="table" aria-label="Tasks">
            <div className="task-row task-head" role="row">
              {mayEdit && (
                <span role="columnheader" className="task-tick">
                  <input
                    type="checkbox"
                    aria-label="Tick every task shown"
                    checked={allTicked}
                    onChange={() => setTicked(allTicked ? new Set() : new Set(shown.map((row) => row.id)))}
                  />
                </span>
              )}
              <span role="columnheader">No.</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Priority</span>
              <span role="columnheader">Description</span>
              <span role="columnheader">Sheet</span>
              <span role="columnheader" className="col-company">Company</span>
              <span role="columnheader">Assigned to</span>
              <span role="columnheader">Due</span>
              <span role="columnheader" className="col-updated">Updated</span>
            </div>

            {groups.map((group) => (
              <div key={group.key} role="rowgroup" className="task-group">
                {group.label && (
                  <div className="task-group-head" role="row">
                    <span role="cell">
                      {group.label} <span className="muted">· {group.rows.length}</span>
                    </span>
                  </div>
                )}
                {group.rows.map((row) => (
                  <div
                    key={row.id}
                    role="row"
                    className={`task-row${row.id === openId ? ' open' : ''}${ticked.has(row.id) ? ' ticked' : ''}`}
                  >
                    {mayEdit && (
                      <span role="cell" className="task-tick">
                        <input
                          type="checkbox"
                          aria-label={`Tick task ${row.number}`}
                          checked={ticked.has(row.id)}
                          onChange={() => toggle(row.id)}
                        />
                      </span>
                    )}
                    <button
                      type="button"
                      className="task-open"
                      onClick={() => setOpenId(row.id)}
                      title={`Open task ${row.number}`}
                    >
                      <span role="cell" className={`task-number status-${row.statusKey}`}>
                        {row.number}
                      </span>
                      <span role="cell" className={`task-chip status-${row.statusKey}`}>
                        {row.status}
                      </span>
                      <span role="cell" className={`task-chip priority-${row.priority}`}>
                        {row.priorityLabel}
                      </span>
                      <span role="cell" className="task-description">
                        {row.isLocked && <span className="task-lock" title="Issued — read-only">🔒 </span>}
                        {row.description || <span className="muted">No description yet</span>}
                      </span>
                      <span role="cell" className="task-sheet">{row.sheetLabel}</span>
                      <span role="cell" className="col-company">{row.company}</span>
                      <span role="cell">{row.assignee}</span>
                      <span role="cell" className={row.isOverdue ? 'task-due overdue' : 'task-due'}>
                        {row.dueDate ? formatDue(row.dueDate) : ''}
                      </span>
                      <span role="cell" className="col-updated muted small">
                        {row.lastChange ? `${row.lastChange.actor.displayName ?? ''} · ${UPDATED.format(new Date(row.lastChange.at))}` : ''}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {openRow && (
        <TaskDrawer
          row={openRow}
          peers={annotations}
          revision={revision}
          onSave={save}
          onClose={() => setOpenId(null)}
          onOpenOnSheet={(row) => onOpenOnSheet({ documentName: row.documentName, pageIndex: row.pageIndex, annotationId: row.id })}
          onPlace={mayEdit ? (row) => setDialog({ kind: 'place', row }) : undefined}
        >
          {renderTaskExtras?.(openRow, afterEdit)}
        </TaskDrawer>
      )}

      {dialog?.kind === 'new' && (
        <NewTaskDialog
          drawings={drawingNames}
          sheetsFor={sheetsFor}
          defaultSheet={defaultSheet}
          onCreateOnSheet={(target) => {
            setDialog(null);
            onCreateOnSheet(target);
          }}
          onCreateOffSheet={createOffSheet}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'place' && defaultSheet && (
        <PlaceTaskDialog
          row={dialog.row}
          drawings={drawingNames}
          sheetsFor={sheetsFor}
          defaultSheet={defaultSheet}
          onPlace={(pick) => place(dialog.row, pick)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** The companies and trades the tasks use, each once whatever its case, sorted. */
function distinctOptions(rows) {
  const distinct = (pick) => {
    const seen = new Map();
    for (const row of rows) {
      const value = pick(row);
      if (value && !seen.has(value.toLocaleLowerCase())) seen.set(value.toLocaleLowerCase(), value);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  };
  return { companies: distinct((row) => row.company), trades: distinct((row) => row.trade) };
}

function formatDue(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return Number.isFinite(year) ? DUE.format(new Date(year, month - 1, day)) : iso;
}

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
