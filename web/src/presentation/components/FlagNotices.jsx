import { MarkupFlagRegistry } from '../../domain/flags';
import { currentFlagContext } from '../flags/flagContext';
import { Icon } from './Icon';

/**
 * Every flag on the selected markup, each with its own sentence — "Overdue —
 * was due 3 Oct 2026, 5 days ago."
 *
 * Reads the list from MarkupFlagRegistry and names no flag, so a new one
 * appears here the moment it is registered. Styled by the flag's tone, the
 * same tone the sheet tints the markup with, so the panel and the drawing
 * agree about how serious it is.
 *
 * @param {object} props
 * @param {import('../../domain/annotations').Annotation} props.annotation
 */
export function FlagNotices({ annotation }) {
  const context = currentFlagContext();
  const flags = MarkupFlagRegistry.flagsFor(annotation, context);
  if (flags.length === 0) return null;

  return flags.map((flag) => (
    <p key={flag.getId()} className={`notice notice-flag notice-flag-${flag.getTone()}`} role="status">
      <Icon name="alert" size={16} />
      {flag.describe(annotation, context)}
    </p>
  ));
}
