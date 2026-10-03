import { DateFieldEditor } from './DateFieldEditor';
import { FieldEditorRegistry } from './FieldEditorRegistry';
import { TextFieldEditor } from './TextFieldEditor';

export { ItemDetailsEditor } from './ItemDetailsEditor';
export { FieldEditorRegistry } from './FieldEditorRegistry';

/**
 * Which component edits each kind of item field.
 *
 * Registered in the barrel that ItemDetailsEditor is imported from, so the
 * editors are in place wherever the panel is — there is no second import to
 * remember. A new kind of input is a new editor file and one line here.
 */
FieldEditorRegistry.register('text', TextFieldEditor);
FieldEditorRegistry.register('date', DateFieldEditor);
