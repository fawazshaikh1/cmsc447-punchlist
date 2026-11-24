import { LocationCheckField } from '../details/fields/LocationCheckField';
import { MarkupFlag } from './MarkupFlag';

/**
 * "Sheet revised — verify location" (D7, SCRUM-91): an item carried forward
 * to a revised set whose place on the new sheet nobody has checked yet. Read
 * from the item's LocationCheckField, so it lasts until someone confirms it.
 */
export class RevisedSheetFlag extends MarkupFlag {
  static ID = 'sheet-revised';

  getId() {
    return RevisedSheetFlag.ID;
  }

  getTone() {
    return 'warning';
  }

  appliesTo(annotation) {
    try {
      return typeof annotation?.details?.get === 'function' && annotation.details.get(LocationCheckField.KEY) !== '';
    } catch {
      return false;
    }
  }

  describe(annotation) {
    const from = annotation.details.get(LocationCheckField.KEY);
    return `Sheet revised — check this item is still in the right place, then confirm its location. It came from ${from}.`;
  }
}
