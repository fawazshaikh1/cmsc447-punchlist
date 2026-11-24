import { useEffect, useState } from 'react';

import { useServices } from '../ServiceContainer';
import { ListDialog } from './ListDialog';
import { messageOf } from './messageOf';

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Recently deleted (spec 8.2): every markup deleted in the project in the
 * last 30 days, newest first, with who deleted it and when, and Restore.
 *
 * Restoring is an ordinary create through EditorService with the markup's
 * own id and creation date — so it is checked, recorded ("Restore") and can
 * be undone, and it comes back with its number, fields, comments and history.
 * The server forgets its copy the moment the markup is saved again. A markup
 * whose drawing has left the project is refused, and says why.
 *
 * Admins only: the server refuses anyone else, and the button that opens
 * this is not offered to them.
 *
 * @param {object} props
 * @param {number} props.projectId
 * @param {(documentName: string, pageIndex: number) => string} props.sheetLabelFor
 * @param {() => void} props.onChanged After a restore — the Tasks tab re-reads.
 * @param {() => void} props.onClose
 */
export function RecentlyDeletedDialog({ projectId, sheetLabelFor, onChanged, onClose }) {
  const { trash, editor } = useServices();
  const [loaded, setLoaded] = useState({ version: -1, items: [], error: null });
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let live = true;
    trash.list(projectId).then(
      (items) => live && setLoaded({ version, items, error: null }),
      (cause) => live && setLoaded({ version, items: [], error: messageOf(cause) }),
    );
    return () => {
      live = false;
    };
  }, [trash, projectId, version]);

  const restore = async (item) => {
    const refusal = item.restoreRefusal();
    if (refusal) {
      setMessage({ tone: 'error', text: refusal });
      return;
    }
    setBusyId(item.annotation.id);
    setMessage(null);
    try {
      const { skipped } = await editor.applyAll([{ previous: null, next: item.annotation }], 'Restore');
      if (skipped.length > 0) throw new Error(skipped[0].reason);
      setMessage({ tone: 'ok', text: `Restored “${titleOf(item)}”. Undo deletes it again.` });
      onChanged();
      setVersion((n) => n + 1);
    } catch (cause) {
      setMessage({ tone: 'error', text: messageOf(cause) });
    } finally {
      setBusyId(null);
    }
  };

  const loading = loaded.version === -1;

  return (
    <ListDialog title="Recently deleted" onClose={onClose}>
      <p className="muted small reversal-intro">
        Markups deleted in the last 30 days. Restoring one brings it back where it was, with its number, fields,
        comments and history.
      </p>
      {message && (
        <p className={message.tone === 'error' ? 'error' : 'notice'} role="status">
          {message.text}
        </p>
      )}
      {loaded.error && <p className="error">{loaded.error}</p>}
      {loading && <p className="muted small" role="status">Loading…</p>}
      {!loading && !loaded.error && loaded.items.length === 0 && (
        <p className="muted reversal-empty">Nothing has been deleted in the last 30 days.</p>
      )}
      {loaded.items.length > 0 && (
        <ul className="reversal-list" aria-label="Recently deleted">
          {loaded.items.map((item) => {
            const refusal = item.restoreRefusal();
            return (
              <li key={item.annotation.id} className="reversal-row">
                <div className="reversal-text">
                  <span className="reversal-title">
                    <span className="reversal-kind">{item.annotation.getTypeName()}</span> {titleOf(item)}
                  </span>
                  <span className="reversal-meta">
                    {item.isOffSheet
                      ? 'Not on a sheet'
                      : `${sheetLabelFor(item.documentName, item.pageIndex)} — ${item.documentName}`}
                  </span>
                  <span className="reversal-meta">
                    Deleted {item.deletedBy ? `by ${item.deletedBy} ` : ''}
                    {WHEN.format(item.deletedAt)}
                  </span>
                  {refusal && <span className="reversal-refusal">{refusal}</span>}
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={Boolean(refusal) || busyId !== null}
                  title={refusal ?? 'Bring it back where it was'}
                  onClick={() => void restore(item)}
                >
                  {busyId === item.annotation.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ListDialog>
  );
}

/** What it said, or what it was when it said nothing. */
function titleOf(item) {
  const { annotation } = item;
  return typeof annotation.label === 'string' && annotation.label.trim() ? annotation.label : `Unlabelled ${annotation.getTypeName().toLowerCase()}`;
}
