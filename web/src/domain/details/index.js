import { ItemFieldRegistry } from './ItemFieldRegistry';
import { TradeField } from './fields/TradeField';
import { ResponsibleCompanyField } from './fields/ResponsibleCompanyField';
import { AssigneeField } from './fields/AssigneeField';
import { DueDateField } from './fields/DueDateField';

export { CalendarDate } from './CalendarDate';
export { ItemField } from './ItemField';
export { TextItemField } from './TextItemField';
export { DateItemField } from './DateItemField';
export { ItemFieldRegistry } from './ItemFieldRegistry';
export { ItemDetails } from './ItemDetails';
export { TradeField, ResponsibleCompanyField, AssigneeField, DueDateField };

/**
 * The fields a punch item carries, IN THE ORDER THE PANEL SHOWS THEM.
 *
 * Registered here rather than at the bottom of each field's file because order
 * is meaningful and has to be stated in one place — the same reason the tools
 * are registered in palette order in `domain/tools/index.js`.
 *
 * To add a field: write it in `fields/`, extending TextItemField or
 * DateItemField (or ItemField for a new kind of input), and add one line below.
 * Nothing else changes — not Pin, not the panel, not storage.
 */
ItemFieldRegistry.register(new TradeField());
ItemFieldRegistry.register(new ResponsibleCompanyField());
ItemFieldRegistry.register(new AssigneeField());
ItemFieldRegistry.register(new DueDateField());
