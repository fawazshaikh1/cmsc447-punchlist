import { MarkupFlagRegistry } from './MarkupFlagRegistry';
import { OverdueFlag } from './OverdueFlag';

export { MarkupFlag } from './MarkupFlag';
export { MarkupFlagRegistry } from './MarkupFlagRegistry';
export { OverdueFlag };

/**
 * The flags the sheet and the panel show, in the order the panel lists them.
 *
 * To add one — "due within 3 days", "nobody assigned" — write a MarkupFlag in
 * this folder and register it below. The sheet colours it by its tone and the
 * panel shows its sentence; neither file changes.
 */
MarkupFlagRegistry.register(new OverdueFlag());
