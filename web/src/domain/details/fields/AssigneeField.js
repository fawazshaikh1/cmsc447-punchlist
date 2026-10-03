import { TextItemField } from '../TextItemField';

/**
 * The person at the responsible company who should do it. Optional — see
 * ResponsibleCompanyField for why the company is the primary assignment.
 */
export class AssigneeField extends TextItemField {
  static KEY = 'assignee';

  getKey() {
    return AssigneeField.KEY;
  }

  getLabel() {
    return 'Assigned to';
  }

  getPlaceholder() {
    return 'Optional — a person at that company';
  }

  /** "Set assigned to of pin" reads badly, so this one words its own change. */
  describeChange(value) {
    return value ? 'Assign' : 'Unassign';
  }
}
