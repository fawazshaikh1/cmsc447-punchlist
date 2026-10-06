import { TextItemField } from '../TextItemField';

/**
 * The discipline responsible for the fix — electrical, drywall, HVAC.
 *
 * Free text with suggestions rather than a fixed list. The suggestions keep
 * the common trades spelled one way, which matters because the task list and
 * the CSV export group by this value; free text keeps a job's oddities
 * ("Elevator", "Stone fabrication") possible without a code change.
 */
export class TradeField extends TextItemField {
  static KEY = 'trade';

  getKey() {
    return TradeField.KEY;
  }

  getLabel() {
    return 'Trade';
  }

  getPlaceholder() {
    return 'e.g. Electrical';
  }

  getSuggestions() {
    return [
      'General',
      'Sitework',
      'Concrete',
      'Masonry',
      'Steel',
      'Carpentry',
      'Millwork',
      'Roofing',
      'Waterproofing',
      'Doors & hardware',
      'Glazing',
      'Drywall',
      'Ceilings',
      'Flooring',
      'Tile',
      'Painting',
      'Fire protection',
      'Plumbing',
      'HVAC',
      'Electrical',
      'Low voltage',
      'Elevators',
      'Landscaping',
    ];
  }
}
