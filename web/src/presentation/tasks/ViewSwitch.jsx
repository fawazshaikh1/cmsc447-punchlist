/**
 * Sheets / Tasks — which of the project's two views is on screen (spec 6.1).
 * A segmented control rather than tabs below the bar, so it costs the
 * drawing no height on a phone.
 *
 * @param {object} props
 * @param {'sheets'|'tasks'} props.view
 * @param {(view: 'sheets'|'tasks') => void} props.onChange
 */
export function ViewSwitch({ view, onChange }) {
  return (
    <div className="view-switch" role="tablist" aria-label="View">
      {[
        ['sheets', 'Sheets'],
        ['tasks', 'Tasks'],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={view === key}
          className={view === key ? 'view-switch-option active' : 'view-switch-option'}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
