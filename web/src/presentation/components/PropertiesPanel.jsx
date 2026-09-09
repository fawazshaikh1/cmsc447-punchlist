import { PinStatus } from '../../domain/annotations';

const STATUS_LABELS = {
  [PinStatus.OPEN]: 'Open',
  [PinStatus.READY_FOR_REVIEW]: 'Ready for review',
  [PinStatus.CLOSED]: 'Closed',
};

/**
 * Edits the selected annotation.
 *
 * ===========================================================================
 * WHY THIS BRANCHES ON CAPABILITY, NOT ON TYPE
 * ===========================================================================
 * The obvious implementation is `if (annotation.getKind() === 'pin') ...`, and
 * it is the same trap the four registries exist to avoid: every new markup type
 * would have to come back and edit this file, and a type whose author forgot
 * would silently have no editable fields.
 *
 * Instead the panel asks what the annotation can DO — does it have a
 * `withLabel`? a `withStatus`? a `withText`? — and renders the matching field.
 * A future markup type that gains a label gets the description box the moment
 * it implements `withLabel`, with no change here.
 *
 * The `with*` methods all return a NEW annotation rather than mutating, so each
 * edit is a value that `EditorService.update` can wrap in a reversible Command.
 * That is why every field below is undoable without the panel knowing what undo
 * is.
 */
export function PropertiesPanel({ annotation, onUpdate, onDelete, onClose }) {
  if (!annotation) return null;

  const canLabel = typeof annotation.withLabel === 'function';
  const canStatus = typeof annotation.withStatus === 'function';
  const canText = typeof annotation.withText === 'function';

  return (
    <aside className="properties">
      <header className="properties-header">
        <strong>{annotation.getKind()}</strong>
        <span className="muted">{annotation.createdAt.toLocaleString()}</span>
        <button type="button" className="icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      {canLabel && (
        <label className="field">
          Description
          {/* Uncontrolled, committed on blur rather than on every keystroke:
              one undo step per edit instead of one per character. The `key`
              forces a fresh input when the underlying value changes from
              outside — after an undo, for instance — so the box does not keep
              showing text that is no longer stored. */}
          <textarea
            rows={3}
            placeholder="What needs fixing here?"
            defaultValue={annotation.label}
            key={`${annotation.id}:${annotation.label}`}
            onBlur={(event) => {
              const next = event.target.value;
              if (next !== annotation.label) {
                onUpdate(annotation, annotation.withLabel(next), 'Describe');
              }
            }}
          />
        </label>
      )}

      {canText && (
        <label className="field">
          Text
          <textarea
            rows={2}
            defaultValue={annotation.text}
            key={`${annotation.id}:${annotation.text}`}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== annotation.text) {
                onUpdate(annotation, annotation.withText(next), 'Edit');
              }
            }}
          />
        </label>
      )}

      {canStatus && (
        <label className="field">
          Status
          <select
            value={annotation.status}
            onChange={(event) =>
              onUpdate(annotation, annotation.withStatus(event.target.value), 'Set status of')
            }
          >
            {Object.values(PinStatus).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="muted small">
        Drag with the Select tool to reposition. Every change here is undoable.
      </p>

      <button type="button" className="danger" onClick={() => onDelete(annotation)}>
        Delete
      </button>
    </aside>
  );
}
