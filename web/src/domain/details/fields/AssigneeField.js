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

  /**
   * The project's people are offered first, so assigning someone means
   * picking a teammate — spelled the way "Assigned to me" will match it.
   */
  getSuggestionSource() {
    return 'people';
  }

  /** "Set assigned to of pin" reads badly, so this one words its own change. */
  describeChange(value) {
    return value ? 'Assign' : 'Unassign';
  }
}
