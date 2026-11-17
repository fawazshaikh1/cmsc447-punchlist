import { useCallback } from 'react';

import { StatusTransition } from '../../domain/reversals';
import { useTextPrompt } from '../components/PromptDialog';
import { useServices } from '../ServiceContainer';

/**
 * @typedef {object} GateDecision
 * @property {string} [label] Replaces the caller's label — the undo button's
 *           words and the history record's detail.
 * @property {(changed: import('../../domain/annotations').Annotation[]) => Promise<void>} [explain]
 *           Posts why, as a comment, on each of `changed` that went back.
 *           Never throws: a reason that cannot be posted is noted in the
 *           console, and the status change still goes ahead.
 */

/**
 * @typedef {(changes: { previous: import('../../domain/annotations').Annotation, next: import('../../domain/annotations').Annotation }[]) => Promise<GateDecision|null>} ChangeGate
 *          Asked before a status change is saved, by the side panel, the task
 *          panel and the Tasks tab's bulk bar. Null cancels the change; `{}`
 *          lets it through as it was.
 */

/**
 * Sending a task back (spec 8.1). Moving a task towards Open — Closed to
 * Ready for review or Open, Ready for review to Open — says the work was not
 * good enough, so it asks why, once however many tasks are going back. The
 * change is recorded as a send back, and the reason is posted as a comment on
 * each task that went back: a comment is a history record, and it is where
 * whoever does the work will see it.
 *
 * Forward moves, and changes that are not about status, pass straight
 * through. Who may change a status at all is the edit policy's business, not
 * this hook's: a collaborator never reaches here, because their status
 * control is read-only and the server refuses the change anyway.
 *
 * In browser mode there are no comments and nobody else to tell, so nothing
 * is asked; the change is still recorded as a send back.
 *
 * @returns {{ gate: ChangeGate, dialog: React.ReactNode }} Render `dialog` once.
 */
export function useSendBack() {
  const { comments } = useServices();
  const { ask, dialog } = useTextPrompt();

  const gate = useCallback(
    async (changes) => {
      const back = StatusTransition.backwardIn(changes);
      if (back.length === 0) return {};
      if (!comments) return { label: StatusTransition.planSendBack(changes, '').label ?? undefined };

      const reason = await ask({
        title: back.length === 1 ? 'Why is it going back?' : `Why are ${back.length} tasks going back?`,
        label: 'Reason — posted as a comment on the task, so whoever does the work sees it',
        placeholder: 'e.g. Closer still slams — adjust the sweep',
        confirmLabel: StatusTransition.sendBackLabel(back[0].next.status),
        multiline: true,
      });
      if (reason === null) return null;

      const plan = StatusTransition.planSendBack(changes, reason);
      return {
        label: plan.label ?? undefined,
        explain: async (changed) => {
          const made = new Set(changed.map((annotation) => annotation.id));
          for (const { annotation, text } of plan.comments) {
            if (!made.has(annotation.id)) continue;
            try {
              await comments.post({ sheetId: annotation.sheetId, annotationId: annotation.id, text });
            } catch (cause) {
              console.warn('[useSendBack] The status changed, but its reason could not be posted as a comment.', cause);
            }
          }
        },
      };
    },
    [ask, comments],
  );

  return { gate, dialog };
}
