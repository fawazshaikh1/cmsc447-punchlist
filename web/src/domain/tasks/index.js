import { GROUPINGS, SORTS } from './builtInOrders';
import { TaskGroupRegistry } from './TaskGroupRegistry';
import { TaskSortRegistry } from './TaskSortRegistry';

/**
 * The Tasks tab's rules (spec 6): which rows there are, and how they are
 * filtered, sorted, grouped and exported. Pure — no React and no storage.
 *
 * Importing this barrel registers the sorts and groupings the tab ships with.
 * A new one is an entry in builtInOrders.js (or a file of its own) and a line
 * here; the Sort and Group menus list whatever is registered.
 */
for (const [key, sort] of SORTS) TaskSortRegistry.register(key, sort);
for (const [key, grouping] of GROUPINGS) TaskGroupRegistry.register(key, grouping);

export { OFF_SHEET_DOCUMENT, isOffSheet } from './offSheet';
export { buildTaskRows } from './taskRows';
export { bySheet, filterTaskRows, fold, groupTaskRows, sortTaskRows } from './TaskQuery';
export { TaskGroupRegistry } from './TaskGroupRegistry';
export { TaskSortRegistry } from './TaskSortRegistry';
export { taskCsv } from './taskCsv';
