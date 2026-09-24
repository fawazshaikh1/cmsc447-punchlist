import { PinStatus } from '../../domain/annotations';
import { useMediaUrl } from '../media/useMediaUrl';
import { Icon } from './Icon';
import { useConfirmation } from './ConfirmDialog';
import { useCommitOnBlur } from './useCommitOnBlur';
import { ClosingNotice, SealedNotice } from './SealingNotice';

/**
 * How much one press of the size buttons changes a markup.
 *
 * 1.2 is a fifth larger, which is visible at a glance but small enough that
 * holding the button gives fine control. Growing and shrinking use the factor
 * and its reciprocal, so a press each way returns to exactly where it started —
 * with anything else, nudging back and forth would drift.
 */
const STEP = 1.2;

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
 * @param {((annotation, factor: number) => void)|undefined} [props.onResize]
 *        Omitted when this annotation has no size to change.
 */
export function PropertiesPanel({
  annotation,
  onUpdate,
  onDelete,
  onClose,
  lock = { allowed: true, denied: false, reason: '' },
  problems = [],
  lastChange = null,
  onResize,
}) {
  const { ask, dialog } = useConfirmation();

  // =========================================================================
  // EVERY HOOK RUNS BEFORE THE EARLY RETURN
  // =========================================================================
  // React requires the same hooks in the same order on every render, so these
  // cannot sit inside the capability branches below. They are therefore written
  // to tolerate a null annotation, and each one is simply never used when its
  // capability is absent.
  const id = annotation?.id;

  const descriptionField = useCommitOnBlur(
    annotation?.label ?? '',
    (next) => onUpdate(annotation, annotation.withLabel(next), 'Describe'),
    id,
  );

  const captionField = useCommitOnBlur(
    annotation?.caption ?? '',
    (next) => onUpdate(annotation, annotation.withCaption(next), 'Caption'),
    id,
  );

  const textField = useCommitOnBlur(
    annotation?.text ?? '',
    (next) => {
      // A callout with no text is not a callout, and TextMarkup's constructor
      // refuses an empty string. Discarding the edit is the only safe answer.
      const trimmed = next.trim();
      if (trimmed) onUpdate(annotation, annotation.withText(trimmed), 'Edit');
    },
    id,
  );

  if (!annotation) return null;

  const readOnly = lock.denied;
  const canLabel = typeof annotation.withLabel === 'function';
  const canStatus = typeof annotation.withStatus === 'function';
  const canText = typeof annotation.withText === 'function';
  // A seventh capability, and the panel needed no restructuring to gain it —
  // implementing `withCaption` is the whole cost of appearing here.
  const canCaption = typeof annotation.withCaption === 'function';

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
            onChange={descriptionField.onChange}
            onBlur={descriptionField.onBlur}
          />
          {descriptionProblem && (
            <span className="field-error">{descriptionProblem.message}</span>
          )}
        </label>
      )}

      {canCaption && (
        <>
          <PhotoPreview media={annotation.media} caption={annotation.caption} />
          <label className="field">
            Caption
            <textarea
              rows={2}
              placeholder={readOnly ? '' : 'What does this photo show?'}
              defaultValue={annotation.caption}
              key={`${annotation.id}:${annotation.caption}`}
              readOnly={readOnly}
              onChange={captionField.onChange}
              onBlur={captionField.onBlur}
            />
          </label>
        </>
      )}

      {canText && (
        <label className="field">
          Text
          <textarea
            rows={2}
            defaultValue={annotation.text}
            key={`${annotation.id}:${annotation.text}`}
            readOnly={readOnly}
            onChange={textField.onChange}
            onBlur={textField.onBlur}
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

      {/* Offered by CAPABILITY, like every other control here: `onResize` is
          passed only when the annotation implements `scaledBy`. A pin has no
          size, so no control appears and nothing had to know that. */}
      {onResize && (
        <div className="field">
          Size
          <div className="size-control">
            <button
              type="button"
              className="size-step"
              disabled={readOnly}
              onClick={() => onResize(annotation, 1 / STEP)}
              aria-label="Make smaller"
              title="Make smaller"
            >
              &#8722;
            </button>
            <span className="size-readout mono">{describeSize(annotation)}</span>
            <button
              type="button"
              className="size-step"
              disabled={readOnly}
              onClick={() => onResize(annotation, STEP)}
              aria-label="Make bigger"
              title="Make bigger"
            >
              +
            </button>
          </div>
        </div>
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
          : onResize
            ? 'Drag with the Select tool to reposition, or use the size buttons. Every change here is undoable.'
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

/**
 * The selected photograph, at panel width.
 *
 * Separate from the panel because it needs a hook, and a hook cannot be called
 * conditionally — inlining `useMediaUrl` inside the `canCaption` branch would
 * change the hook order between a pin and a photo and break React's rules.
 * Extracting it means the hook always runs, exactly once, in its own component.
 */
function PhotoPreview({ media, caption }) {
  const { url, loading } = useMediaUrl(media?.key);

  if (!media) return null;

  return (
    <div className="photo-thumb">
      {url ? (
        <img src={url} alt={caption || 'Photo attached to this markup'} />
      ) : (
        <div className="photo-thumb-empty">
          {loading ? (
            <span className="muted small">Loading photo…</span>
          ) : (
            <>
              <Icon name="alert" size={20} />
              <span className="muted small">
                Not on this device. It will export as a marked placeholder.
              </span>
            </>
          )}
        </div>
      )}
      <p className="muted small">
        {media.width}&#215;{media.height}
        {media.byteSize > 0 && ` · ${Math.round(media.byteSize / 1024)} KB`}
      </p>
    </div>
  );
}

/**
 * The size to show beside the buttons, in the unit that markup is measured in.
 *
 * A photo is a width on the sheet, a callout is a type size, a box is a
 * diagonal. Reading `widthPts` off everything would be wrong for two of the
 * three, so each is asked for what it actually has — still without naming a
 * type, by checking which property is there.
 */
function describeSize(annotation) {
  if (typeof annotation.widthPts === 'number') return `${Math.round(annotation.widthPts)} pt wide`;
  if (typeof annotation.fontSize === 'number') return `${Math.round(annotation.fontSize)} pt type`;

  if (typeof annotation.getBounds === 'function') {
    const { width, height } = annotation.getBounds();
    return `${Math.round(width)} × ${Math.round(height)} pt`;
  }

  return 'scalable';
}
