import { ItemField } from '../ItemField';

/**
 * "Sheet revised — verify location" (D7, SCRUM-91), stored on the item.
 *
 * When open items carry forward to a revised set they land at the same spot
 * on the sheet with the same number — which is right only if the drawing did
 * not move under them. The value is the set the item came from; empty means
 * its place has been checked. A field rather than a flag alone so it is saved
 * with the item, survives a reload, and is cleared by an ordinary edit — which
 * only an admin or power collaborator may make, as D7 asks. RevisedSheetFlag
 * reads it to tint the pin and explain it in the panel.
 */
export class LocationCheckField extends ItemField {
  static KEY = 'locationCheck';

  getKey() {
    return LocationCheckField.KEY;
  }

  getLabel() {
    return 'Location';
  }

  /** Drawn as a "Confirm location" button while set, and not at all when clear. */
  getInputKind() {
    return 'confirm';
  }

  normalize(raw) {
    return typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
  }

  /** On the schedule and in exports: why the place may be wrong. */
  format(value) {
    return value ? `Check - sheet revised from ${value}` : '';
  }

  describeChange(value) {
    return value ? 'Flag the location of' : 'Confirm the location of';
  }
}
