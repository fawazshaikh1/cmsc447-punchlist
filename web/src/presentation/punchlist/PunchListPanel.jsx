import { useContext, useId, useMemo, useState } from 'react';

import { PinStatus } from '../../domain/annotations';
import { STATUS_LABELS, TaskFilter, buildTaskList, filterTaskList, taskListOptions } from '../../domain/punchlist';
import { currentFlagContext } from '../flags/flagContext';
import { SessionContext } from '../session/useSession';
import { usePunchListItems } from './usePunchListItems';
import './punchlist.css';

const STATUS_CHOICES = [
  [TaskFilter.ANY, 'Any status'],
  [TaskFilter.OUTSTANDING, 'Still to do'],
  [TaskFilter.OVERDUE, 'Overdue'],
  [PinStatus.OPEN, STATUS_LABELS[PinStatus.OPEN]],
  [PinStatus.READY_FOR_REVIEW, STATUS_LABELS[PinStatus.READY_FOR_REVIEW]],
  [PinStatus.CLOSED, STATUS_LABELS[PinStatus.CLOSED]],
];

const DUE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/**
 * The punch list, in the side panel (SCRUM-32, SCRUM-52): every punch item in
 * the project, by drawing, numbered as their pins are, with filters for
 * status, company, trade and "assigned to me".
 *
 * Tapping an item on the drawing on screen goes to its sheet and selects it.
 * An item on another drawing says which file to open — the drawings
 * themselves are on the devices that opened them, not yet on the server.
 *
 * Holds no rule about items. What counts as one, how they are numbered and
 * what each filter means are in domain/punchlist/TaskList.
 *
 * @param {object} props
 * @param {boolean} props.active Whether the list is on screen; it reads only then.
 * @param {string|null} props.documentName The drawing on screen.
 * @param {number} props.pageCount
 * @param {(pageIndex: number) => string|null} props.sheetIdFor
 * @param {unknown} props.changeKey Changes when the open sheet's markups do.
 * @param {(item: import('../../domain/punchlist/TaskList').TaskListItem) => void} props.onGo
 */
export function PunchListPanel({ active, documentName, pageCount, sheetIdFor, changeKey, onGo }) {
  const account = useContext(SessionContext)?.account ?? null;
  const { items, error } = usePunchListItems({ active, documentName, pageCount, sheetIdFor, changeKey });
  const [filters, setFilters] = useState({ status: TaskFilter.OUTSTANDING, company: '', trade: '', mine: false, query: '' });
  const ids = useId();

  const groups = useMemo(
    () => (items ? buildTaskList(items, { today: currentFlagContext().today, openDocument: documentName }) : []),
    [items, documentName],
  );
  const options = useMemo(() => taskListOptions(groups), [groups]);
  const shown = useMemo(
    () => filterTaskList(groups, { ...filters, assignedTo: filters.mine && account ? account.displayName : null }),
    [groups, filters, account],
  );

  const total = groups.reduce((n, group) => n + group.items.length, 0);
  const overdue = groups.reduce((n, group) => n + group.items.filter((item) => item.flags.includes('overdue')).length, 0);
  const showing = shown.reduce((n, group) => n + group.items.length, 0);
  const set = (key) => (event) => setFilters((f) => ({ ...f, [key]: event.target.value }));
  const filtered =
    filters.status !== TaskFilter.ANY || filters.company || filters.trade || filters.mine || filters.query.trim();

  return (
    <section className="punch-list" aria-label="Punch list">
      <div className="punch-filters">
        <input
          type="search"
          className="punch-search"
          placeholder="Search items"
          aria-label="Search items"
          value={filters.query}
          onChange={set('query')}
        />
        <div className="punch-filter-row">
          <label className="visually-hidden" htmlFor={`${ids}-status`}>Status</label>
          <select id={`${ids}-status`} value={filters.status} onChange={set('status')}>
            {STATUS_CHOICES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="visually-hidden" htmlFor={`${ids}-company`}>Company</label>
          <select id={`${ids}-company`} value={filters.company} onChange={set('company')}>
            <option value="">Any company</option>
            {options.companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
          <label className="visually-hidden" htmlFor={`${ids}-trade`}>Trade</label>
          <select id={`${ids}-trade`} value={filters.trade} onChange={set('trade')}>
            <option value="">Any trade</option>
            {options.trades.map((trade) => (
              <option key={trade} value={trade}>
                {trade}
              </option>
            ))}
          </select>
        </div>
        {account && (
          <label className="punch-mine">
            <input
              type="checkbox"
              checked={filters.mine}
              onChange={(event) => setFilters((f) => ({ ...f, mine: event.target.checked }))}
            />
            Assigned to me
          </label>
        )}
      </div>

      <p className="punch-summary muted small" role="status">
        {items === null
          ? 'Loading the punch list…'
          : `${filtered ? `${showing} of ${total}` : total} item${total === 1 ? '' : 's'}` +
            (overdue ? ` · ${overdue} overdue` : '')}
        {filtered && (
          <button
            type="button"
            className="punch-clear"
            onClick={() => setFilters({ status: TaskFilter.ANY, company: '', trade: '', mine: false, query: '' })}
          >
            Show all
          </button>
        )}
      </p>

      {error && <p className="error punch-error">{error}</p>}

      {items !== null && total === 0 && (
        <p className="punch-empty muted small">No punch items yet. Pick the Pin tool and tap the drawing to raise one.</p>
      )}
      {items !== null && total > 0 && showing === 0 && (
        <p className="punch-empty muted small">Nothing matches these filters.</p>
      )}

      {shown.map((group) => (
        <div key={group.documentName} className="punch-group">
          <h3 className="punch-group-title">
            <span>{group.documentName}</span>
            {!group.isOpen && <span className="muted small">open this drawing to go to its items</span>}
          </h3>
          <ol className="punch-items">
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="punch-item"
                  disabled={!group.isOpen}
                  onClick={() => onGo(item)}
                  title={group.isOpen ? `Go to item ${item.number} on sheet ${item.pageIndex + 1}` : `Open ${group.documentName} to see it on the drawing`}
                >
                  <span className={`punch-number status-${item.statusKey}`}>{item.number}</span>
                  <span className="punch-body">
                    <span className={item.description ? 'punch-description' : 'punch-description muted'}>
                      {item.description || 'No description yet'}
                    </span>
                    <span className="punch-meta">
                      {[`Sheet ${item.pageIndex + 1}`, item.status, item.company, item.trade, item.assignee && `→ ${item.assignee}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {item.dueDate && (
                    <span className={item.flags.includes('overdue') ? 'punch-due overdue' : 'punch-due'}>
                      {item.flags.includes('overdue') ? 'Overdue' : 'Due'} {formatDue(item.dueDate)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

/** "2026-10-10" → "10 Oct", in the reader's own order. */
function formatDue(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return Number.isFinite(year) ? DUE.format(new Date(year, month - 1, day)) : iso;
}
