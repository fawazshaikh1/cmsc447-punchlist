import { Icon } from '../components/Icon';

/**
 * The offer to carry open items forward to the revised set on screen, and
 * what happened when they were (SCRUM-91). State from useCarryForward.
 *
 * @param {object} props
 * @param {ReturnType<import('./useCarryForward').useCarryForward>} props.carry
 * @param {string} props.documentName
 */
export function CarryForwardBanner({ carry, documentName }) {
  if (!carry.visible) return null;

  if (carry.message) {
    return (
      <p className={carry.message.tone === 'error' ? 'error carry-forward' : 'notice carry-forward'} role="status">
        <Icon name={carry.message.tone === 'error' ? 'alert' : 'check'} size={18} />
        <span className="carry-forward-text">{carry.message.text}</span>
        <button type="button" className="btn" onClick={carry.dismiss}>
          OK
        </button>
      </p>
    );
  }

  const { moves, left } = carry.plan;
  const reasons = [...new Set(left.map(({ reason }) => reason))].join(' ');
  return (
    <div className="notice carry-forward" role="status">
      <span className="carry-forward-text">
        <strong>
          {documentName} is a revision of {carry.previous.name}.
        </strong>{' '}
        {moves.length > 0
          ? `${moves.length} open item${moves.length === 1 ? '' : 's'} can move to the sheets with the same numbers here, each flagged so someone checks its place.`
          : `Its ${left.length} open item${left.length === 1 ? '' : 's'} stay${left.length === 1 ? 's' : ''} there: ${reasons}`}
        {moves.length > 0 && left.length > 0 && ` ${left.length} cannot: ${reasons}`}
      </span>
      <span className="carry-forward-actions">
        {moves.length > 0 && (
          <button type="button" className="btn primary" disabled={carry.busy} onClick={() => void carry.carry()}>
            {carry.busy ? 'Moving…' : `Carry forward ${moves.length}`}
          </button>
        )}
        <button type="button" className="btn" onClick={carry.dismiss}>
          {moves.length > 0 ? 'Not now' : 'OK'}
        </button>
      </span>
    </div>
  );
}
