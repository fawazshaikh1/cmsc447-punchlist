import { useEffect, useState } from 'react';

import { useConfirmation } from '../components/ConfirmDialog';
import { useTextPrompt } from '../components/PromptDialog';
import { useServices } from '../ServiceContainer';
import { ListDialog } from './ListDialog';
import { messageOf } from './messageOf';

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Issue history (spec 8.3): every PDF issued in the project, newest first —
 * when, by whom, how many markups it locked — and Void issue.
 *
 * Voiding is the one way an issued markup is unlocked, so it warns first that
 * copies already sent cannot be recalled, asks why, and leaves the issue in
 * the list marked void with who, when and the reason. Markups a later issue
 * also locked stay locked by that issue. Admins only, as on the server.
 *
 * @param {object} props
 * @param {number} props.projectId
 * @param {() => void} props.onChanged After a void — the Tasks tab re-reads
 *        its locks, so the unlocked tasks can be edited at once.
 * @param {() => void} props.onClose
 */
export function IssueHistoryDialog({ projectId, onChanged, onClose }) {
  const { issues } = useServices();
  const { ask: confirm, dialog: confirmDialog } = useConfirmation();
  const { ask: askText, dialog: promptDialog } = useTextPrompt();
  const [loaded, setLoaded] = useState({ version: -1, list: [], error: null });
  const [version, setVersion] = useState(0);
  const [asking, setAsking] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let live = true;
    issues.list(projectId).then(
      (list) => live && setLoaded({ version, list, error: null }),
      (cause) => live && setLoaded({ version, list: [], error: messageOf(cause) }),
    );
    return () => {
      live = false;
    };
  }, [issues, projectId, version]);

  const voidIssue = async (issue) => {
    setAsking(true);
    setMessage(null);
    try {
      const sure = await confirm({
        title: `Void the issue of ${issue.documentName}?`,
        body: (
          <>
            <p>
              The {issue.sealedCount} markup{issue.sealedCount === 1 ? '' : 's'} it locked can be changed again,
              unless a later issue also locked them.
            </p>
            <p>
              <strong>Copies already sent cannot be recalled.</strong> Anyone who has the PDF still has it. The issue
              stays in this list, marked void.
            </p>
          </>
        ),
        confirmLabel: 'Continue',
        cancelLabel: 'Keep it',
        tone: 'danger',
      });
      if (!sure) return;
      const reason = await askText({
        title: 'Why is it being voided?',
        label: 'Reason — kept with the issue',
        placeholder: 'e.g. Issued from the wrong drawing set',
        confirmLabel: 'Void issue',
        multiline: true,
      });
      if (reason === null) return;
      setBusyId(issue.id);
      await issues.void(issue.id, reason);
      setMessage({ tone: 'ok', text: 'Voided. Its markups are unlocked, unless a later issue also locked them.' });
      onChanged();
      setVersion((n) => n + 1);
    } catch (cause) {
      setMessage({ tone: 'error', text: messageOf(cause) });
    } finally {
      setAsking(false);
      setBusyId(null);
    }
  };

  const loading = loaded.version === -1;

  return (
    <>
      <ListDialog title="Issue history" onClose={onClose} escapeCloses={!asking}>
        <p className="muted small reversal-intro">
          Every PDF issued in this project. Voiding one unlocks what it locked; it stays here, marked void.
        </p>
        {message && (
          <p className={message.tone === 'error' ? 'error' : 'notice'} role="status">
            {message.text}
          </p>
        )}
        {loaded.error && <p className="error">{loaded.error}</p>}
        {loading && <p className="muted small" role="status">Loading…</p>}
        {!loading && !loaded.error && loaded.list.length === 0 && (
          <p className="muted reversal-empty">No PDF has been issued in this project yet.</p>
        )}
        {loaded.list.length > 0 && (
          <ul className="reversal-list" aria-label="Issued PDFs">
            {loaded.list.map((issue) => (
              <li key={issue.id} className={issue.isVoid ? 'reversal-row is-void' : 'reversal-row'}>
                <div className="reversal-text">
                  <span className="reversal-title">{issue.documentName}</span>
                  <span className="reversal-meta">
                    Issued {WHEN.format(issue.exportedAt)} by {issue.exportedBy} · {issue.sealedCount} markup
                    {issue.sealedCount === 1 ? '' : 's'} locked
                  </span>
                  {issue.isVoid && (
                    <span className="reversal-void">
                      Void — {issue.voidedBy}, {WHEN.format(issue.voidedAt)}: {issue.voidReason}
                    </span>
                  )}
                </div>
                {issue.isVoid ? (
                  <span className="reversal-badge">Void</span>
                ) : (
                  <button
                    type="button"
                    className="btn danger-text"
                    disabled={asking || busyId !== null}
                    onClick={() => void voidIssue(issue)}
                  >
                    {busyId === issue.id ? 'Voiding…' : 'Void issue'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </ListDialog>
      {confirmDialog}
      {promptDialog}
    </>
  );
}
