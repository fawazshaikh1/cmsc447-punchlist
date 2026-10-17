import { SealedNotice } from './SealingNotice';

/**
 * Why the selected markup cannot be changed, in the words that fit the
 * reason.
 *
 * Two different things lock a markup, and they deserve different sentences.
 * An issued markup is part of the permanent record — "Issued — read only" is
 * the whole story. A role that cannot edit is about the person, not the
 * markup: the same item is editable by their project admin, so the notice
 * says so rather than implying the item itself is frozen.
 *
 * @param {object} props
 * @param {import('../../domain/policy').EditDecision} props.lock A denial.
 */
export function LockNotice({ lock }) {
  if (lock.code === 'sealed') return <SealedNotice reason={lock.reason} />;

  return (
    <p className="notice notice-locked">
      <span>
        <strong>View only.</strong> {lock.reason}
      </span>
    </p>
  );
}
