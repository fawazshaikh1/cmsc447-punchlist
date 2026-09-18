/**
 * Barrel for the edit-permission layer.
 *
 * Importing from here rather than from individual files means a new policy is
 * added by writing the class and adding one export line — call sites are
 * untouched.
 */
export { EditDecision } from './EditDecision';
export { EditPolicy } from './EditPolicy';
export { EditNotPermittedError } from './EditNotPermittedError';
export { ActiveSeals } from './ActiveSeals';

// --- Concrete policies ------------------------------------------------------
export { AllowAllPolicy } from './AllowAllPolicy';
export { SealedByExportPolicy } from './SealedByExportPolicy';
export { CompositeEditPolicy } from './CompositeEditPolicy';

// Written, intentionally NOT wired — see the file for why and for the one-line
// change that switches roles on.
export { RoleEditPolicy } from './RoleEditPolicy';
