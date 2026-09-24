/**
 * The words the product uses to explain that work becomes permanent.
 *
 * ===========================================================================
 * WHY THE WORDING LIVES IN ONE FILE
 * ===========================================================================
 * Three different moments have to explain the same rule: closing an item,
 * issuing a flattened PDF, and a markup that is already sealed. If each wrote
 * its own sentence they would drift, and a user who read "cannot be edited" in
 * one place and "is finalised" in another would reasonably wonder whether they
 * mean the same thing. On a promise about permanence, that doubt is expensive.
 *
 * One file also means the wording can be reviewed by the stakeholder as a
 * single thing, and corrected in a single place when they say it is not quite
 * how a superintendent would put it.
 *
 * These are components rather than strings so the emphasis is part of the
 * message: the sentence that costs the user something is the one in bold.
 */

/**
 * Shown when marking a punch-list item Closed.
 *
 * The honest thing to say here is that closing is NOT itself the point of no
 * return — issuing the PDF is. Overstating it ("this cannot be undone") would
 * make people avoid closing items, and a punch list nobody closes is not a
 * punch list.
 */
export function ClosingNotice() {
  return (
    <>
      <p>
        Marking this item <strong>Closed</strong> records it as finished and
        ready to be checked.
      </p>
      <p>
        You can still reopen it, edit its description, move it or delete it
        afterwards — <strong>until it is included in a flattened PDF export.</strong>
      </p>
      <p>
        Exporting a flattened PDF paints every markup into the drawing itself
        and issues it. From that moment this item becomes part of the permanent
        record and can no longer be changed here — you would add a new item on
        top of it instead.
      </p>
    </>
  );
}

/**
 * Shown before a flattened export. This IS the point of no return, and the
 * wording says so plainly.
 *
 * @param {object} props
 * @param {number} props.annotationCount
 * @param {number} props.sheetCount
 * @param {number} [props.incompleteCount] Markups still missing something —
 *        almost always a pin placed before descriptions were required.
 */
export function FlattenExportNotice({ annotationCount, sheetCount, incompleteCount = 0 }) {
  return (
    <>
      {/* Shown FIRST, above the explanation of permanence, because it is the
          one thing here the user can still act on. Everything below is a
          consequence they can only accept or decline. */}
      {incompleteCount > 0 && (
        <p className="notice notice-incomplete">
          <strong>
            {incompleteCount} pin{incompleteCount === 1 ? ' has' : 's have'} no
            description.
          </strong>{' '}
          Issued like this {incompleteCount === 1 ? 'it' : 'they'} will reach the
          architect as {incompleteCount === 1 ? 'a bare number' : 'bare numbers'}{' '}
          on the drawing, with nothing to explain{' '}
          {incompleteCount === 1 ? 'it' : 'them'} — and{' '}
          {incompleteCount === 1 ? 'it' : 'they'} cannot be edited afterwards.
          Consider cancelling and filling {incompleteCount === 1 ? 'it' : 'them'}{' '}
          in first.
        </p>
      )}

      <p>
        This paints every markup into the drawing itself, so the file opens
        correctly in Acrobat, Bluebeam, PlanGrid and any other PDF viewer.
      </p>
      <p>
        <strong>
          The {annotationCount} markup{annotationCount === 1 ? '' : 's'} on{' '}
          {sheetCount} sheet{sheetCount === 1 ? '' : 's'} will become permanent.
        </strong>{' '}
        Once issued they cannot be moved, edited, reopened or deleted — because
        the file you are handing over cannot be changed either, and the two must
        not disagree.
      </p>
      <p>
        You can keep working on the drawing afterwards by adding new markups.
        This step cannot be undone.
      </p>
      <p className="muted small">
        Need a copy you can still edit? Use <strong>Export (editable)</strong>{' '}
        instead — it issues nothing and seals nothing.
      </p>
    </>
  );
}

/**
 * The inline explanation on a markup that is already sealed.
 *
 * Deliberately short. The long version has already been read at the moment it
 * mattered; here the user just needs to know why the fields are greyed out.
 *
 * @param {object} props
 * @param {string} [props.reason] The policy's own wording, when there is one.
 *        Preferred over the default, so a future refusal for a different reason
 *        (a role, say) explains itself correctly through this same component.
 */
export function SealedNotice({ reason }) {
  return (
    <p className="notice notice-locked">
      <strong>Issued — read only.</strong>{' '}
      {reason ??
        'This markup was included in a flattened PDF that has already been issued, so it is now part of the permanent record.'}
    </p>
  );
}
