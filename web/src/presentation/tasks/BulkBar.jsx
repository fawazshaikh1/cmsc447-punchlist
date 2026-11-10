import { useContext, useId, useState } from 'react';

import { PinStatus } from '../../domain/annotations';
import { PriorityField } from '../../domain/details';
import { STATUS_LABELS } from '../../domain/punchlist';
import { SuggestionSourcesContext } from '../components/details/SuggestionSources';

/**
 * Changes every ticked task at once (spec 6.6): status, priority, company,
 * assignee, due date, or delete. Each change is ONE undo step whatever the
 * number of tasks, and tasks the person may not change are skipped and named
 * — the Tasks tab does that through EditorService.applyAll; this bar only
 * says what to change.
 *
 * @param {object} props
 * @param {number} props.count How many tasks are ticked.
 * @param {(transform: (annotation) => object, label: string) => void} props.onApply
 * @param {() => void} props.onDelete
 * @param {() => void} props.onClear
 */
export function BulkBar({ count, onApply, onDelete, onClear }) {
  const ids = useId();
  const people = useContext(SuggestionSourcesContext).people ?? [];
  const [company, setCompany] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');

  const detail = (key, value, label) => onApply((annotation) => annotation.withDetail(key, value), label);

  return (
    <div className="bulk-bar" role="region" aria-label="Change the ticked tasks">
      <strong className="bulk-count">{count} ticked</strong>

      <select
        aria-label="Set status"
        value=""
        onChange={(event) => {
          const status = event.target.value;
          if (status) onApply((annotation) => annotation.withStatus(status), `Set status to ${STATUS_LABELS[status]}`);
        }}
      >
        <option value="">Status…</option>
        {Object.values(PinStatus).map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <select
        aria-label="Set priority"
        value=""
        onChange={(event) => {
          const level = event.target.value;
          if (level) detail(PriorityField.KEY, level, `Set priority to ${PriorityField.LABELS[level]}`);
        }}
      >
        <option value="">Priority…</option>
        {PriorityField.LEVELS.map((level) => (
          <option key={level} value={level}>
            {PriorityField.LABELS[level]}
          </option>
        ))}
      </select>

      <form
        className="bulk-field"
        onSubmit={(event) => {
          event.preventDefault();
          detail('responsibleCompany', company, company ? `Set company to ${company}` : 'Clear company');
          setCompany('');
        }}
      >
        <input aria-label="Company" placeholder="Company" value={company} onChange={(event) => setCompany(event.target.value)} />
        <button type="submit" className="btn">Set</button>
      </form>

      <form
        className="bulk-field"
        onSubmit={(event) => {
          event.preventDefault();
          detail('assignee', assignee, assignee ? `Assign to ${assignee}` : 'Clear assignee');
          setAssignee('');
        }}
      >
        <input
          aria-label="Assigned to"
          placeholder="Assigned to"
          list={`${ids}-people`}
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
        />
        <datalist id={`${ids}-people`}>
          {people.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button type="submit" className="btn">Set</button>
      </form>

      <form
        className="bulk-field"
        onSubmit={(event) => {
          event.preventDefault();
          detail('dueDate', due, due ? `Set due date to ${due}` : 'Clear due date');
          setDue('');
        }}
      >
        <input type="date" aria-label="Due date" value={due} onChange={(event) => setDue(event.target.value)} />
        <button type="submit" className="btn">Set</button>
      </form>

      <button type="button" className="btn danger-text" onClick={onDelete}>
        Delete
      </button>
      <button type="button" className="btn ghost" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
