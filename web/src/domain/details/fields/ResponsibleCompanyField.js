import { TextItemField } from '../TextItemField';

/**
 * The trade contractor who has to fix it.
 *
 * Assignment is to a company first and a person second (D6): the general
 * contractor always knows which subcontractor does the electrical, rarely
 * which of their electricians will turn up, and people leave mid-project while
 * companies do not.
 *
 * Free text until accounts exist. When companies become records, this field is
 * replaced by one whose input kind picks from them — a new field file and a new
 * editor, with values already stored here still readable.
 */
export class ResponsibleCompanyField extends TextItemField {
  static KEY = 'responsibleCompany';

  getKey() {
    return ResponsibleCompanyField.KEY;
  }

  getLabel() {
    return 'Responsible company';
  }

  getPlaceholder() {
    return 'e.g. Rivera Electric';
  }
}
