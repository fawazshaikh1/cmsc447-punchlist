import { PinStatus } from '../../domain/annotations';
import { useConfirmation } from './ConfirmDialog';
import { ClosingNotice, SealedNotice } from './SealingNotice';

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
 * it is the same trap the registries exist to avoid: every new markup type
 * would have to come back and edit this file, and a type whose author forgot
 * would silently have no editable fields.
 *
 * Instead the panel asks what the annotation can DO — does it have a
 * `withLabel`? a `withStatus`? a `withText`? — and renders the matching field.
 * A future markup type that gains a label gets the description box the moment
 * it implements `withLabel`, with no change here.
 *
 * ===========================================================================
 * AND WHY IT ASKS RATHER THAN CHECKING ANYTHING ITSELF
 * ===========================================================================
 * Three questions are answered elsewhere and arrive as data:
 *
 *   lock        may this be changed?        EditPolicy, via EditorService
 *   problems    is it finished?             AnnotationRuleRegistry
 *   lastChange  who last touched it?        ChangeLogRepository
 *
 * This component renders all three without knowing what a seal is, what a rule
 * is, or where history is stored. When roles are switched on, `lock` starts
 * carrying role refusals and this file does not change. When sign-in lands,
 * `lastChange` starts naming people and this file does not change.
 *
 * The disabled controls are belt and braces, not the enforcement — EditorService
 * refuses the write regardless. They exist so the user is told before they type
 * a paragraph into a box that was never going to save.
 *
 * @param {object} props
 * @param {import('../../domain/annotations').Annotation|null} props.annotation
 * @param {(previous, next, label) => void} props.onUpdate
 * @param {(annotation) => void} props.onDelete
 * @param {() => void} props.onClose
 * @param {import('../../domain/policy').EditDecision} [props.lock]
 * @param {import('../../domain/rules').RuleViolation[]} [props.problems]
 * @param {import('../../domain/audit/ChangeRecord').ChangeRecord|null} [props.lastChange]
 */
export function PropertiesPanel({
  annotation,
  onUpdate,
  onDelete,
  onClose,
  lock = { allowed: true, denied: false, reason: '' },
  problems = [],
  lastChange = null,
}) {
  const { ask, dialog } = useConfirmation();

  if (!annotation) return null;

  const readOnly = lock.denied;
  const canLabel = typeof annotation.withLabel === 'function';
  const canStatus = typeof annotation.withStatus === 'function';
  const canText = typeof annotation.withText === 'function';

  /** The problem attached to one input, if any. Drives the inline message. */
  const problemFor = (field) => problems.find((violation) => violation.field === field);

  /**
   * Changing status, with a warning the first time an item is closed.
   *
   * The warning fires on CLOSED only. Asking on every status change would train
   * people to dismiss it without reading, which is exactly how a confirmation
   * stops being a safeguard.
   */
  const changeStatus = async (next) => {
    if (next === PinStatus.CLOSED && annotation.status !== PinStatus.CLOSED) {
      const confirmed = await ask({
        title: 'Close this item?',
        body: <ClosingNotice />,
        confirmLabel: 'Close item',
        cancelLabel: 'Not yet',
      });
      if (!confirmed) return;
    }

    onUpdate(annotation, annotation.withStatus(next), 'Set status of');
  };

  const descriptionProblem = problemFor('label');

  return (
    <aside
      className={`properties${readOnly ? ' properties-locked' : ''}${
        problems.length > 0 ? ' properties-incomplete' : ''
      }`}
    >
      {dialog}

      <header className="properties-header">
        <strong>{annotation.getKind()}</strong>
        <span className="muted">{annotation.createdAt.toLocaleString()}</span>
        <button type="button" className="icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      {readOnly && <SealedNotice reason={lock.reason} />}

      {/* Problems that are not tied to a specific input are shown together at
          the top. Field-level ones appear under their own control instead, so
          the user's eye lands on the box they have to fix. */}
      {problems
        .filter((violation) => !violation.field)
        .map((violation) => (
          <p key={violation.code} className="notice notice-incomplete">
            {violation.message}
          </p>
        ))}

      {canLabel && (
        <label className={`field${descriptionProblem ? ' field-invalid' : ''}`}>
          Description
          {/* Uncontrolled, committed on blur rather than on every keystroke:
              one undo step per edit instead of one per character. The `key`
              forces a fresh input when the underlying value changes from
              outside — after an undo, for instance — so the box does not keep
              showing text that is no longer stored. */}
          <textarea
            rows={3}
            placeholder={readOnly ? '' : 'What needs fixing here?'}
            defaultValue={annotation.label}
            key={`${annotation.id}:${annotation.label}`}
            readOnly={readOnly}
            aria-invalid={descriptionProblem ? 'true' : undefined}
            onBlur={(event) => {
              const next = event.target.value;
              if (next !== annotation.label) {
                onUpdate(annotation, annotation.withLabel(next), 'Describe');
              }
            }}
          />
          {descriptionProblem && (
            <span className="field-error">{descriptionProblem.message}</span>
          )}
        </label>
      )}

      {canText && (
        <label className="field">
          Text
          <textarea
            rows={2}
            defaultValue={annotation.text}
            key={`${annotation.id}:${annotation.text}`}
            readOnly={readOnly}
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
            disabled={readOnly}
            onChange={(event) => void changeStatus(event.target.value)}
          >
            {Object.values(PinStatus).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* D14: last updated and by whom, without opening anything. Reads "this
          device edited it, 18/09/2026, 11:22" until sign-in exists, then names
          a person — with no change to this markup. */}
      {lastChange && (
        <p className="muted small attribution">
          {lastChange.describe()},{' '}
          <time dateTime={lastChange.at}>
            {new Date(lastChange.at).toLocaleString()}
          </time>
        </p>
      )}

      <p className="muted small">
        {readOnly
          ? 'Add a new markup on top if something here still needs work.'
          : 'Drag with the Select tool to reposition. Every change here is undoable.'}
      </p>

      <button
        type="button"
        className="danger"
        disabled={readOnly}
        onClick={() => onDelete(annotation)}
      >
        Delete
      </button>
    </aside>
  );
}
