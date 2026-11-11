import { useCallback, useEffect, useState } from 'react';

import { threadsOf } from '../../domain/comments';
import { EditPolicy } from '../../domain/policy';
import { useServices } from '../ServiceContainer';
import './comments.css';

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const MAX_LENGTH = 2000;

/**
 * The conversation about one item (spec 7.1), in the task panel and in the
 * sheet's side panel: threads, oldest first, each with its replies, as in
 * Bluebeam.
 *
 * Anyone on the project may comment and reply, collaborators included
 * (FR-11.4), and an issued item still takes comments — the edit policy says
 * so, not this component. A comment is never edited or deleted: it is part
 * of the item's history.
 *
 * Server mode only; in browser mode there is no one to talk to, and the
 * section is not shown.
 *
 * @param {object} props
 * @param {import('../../domain/annotations').Annotation} props.annotation
 * @param {() => void} [props.onPosted] After a comment is saved — the Tasks
 *        tab re-reads its counts.
 */
export function CommentsSection({ annotation, onPosted }) {
  const { comments, editor } = useServices();
  const [loaded, setLoaded] = useState({ id: null, list: [], revision: -1 });
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!comments || !annotation) return undefined;
    let live = true;
    comments.listFor(annotation.id).then(
      (list) => live && setLoaded({ id: annotation.id, list, revision }),
      () => live && setLoaded({ id: annotation.id, list: [], revision }),
    );
    return () => {
      live = false;
    };
  }, [comments, annotation, revision]);

  const post = useCallback(
    async (text, answering) => {
      if (!text.trim() || posting) return false;
      setPosting(true);
      setError(null);
      try {
        await comments.post({ sheetId: annotation.sheetId, annotationId: annotation.id, text, replyTo: answering ?? '' });
        setRevision((n) => n + 1);
        onPosted?.();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        setPosting(false);
      }
    },
    [comments, annotation, onPosted, posting],
  );

  if (!comments || !annotation) return null;

  const mayComment = editor.canEdit(annotation, EditPolicy.INTENT.COMMENT).allowed;
  const current = loaded.id === annotation.id;
  const threads = current ? threadsOf(loaded.list) : [];

  return (
    <section className="comments" aria-label="Comments">
      <h3 className="details-title">
        Comments{current && loaded.list.length > 0 ? ` · ${loaded.list.length}` : ''}
      </h3>

      {!current ? (
        <p className="muted small">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="muted small">No comments yet.</p>
      ) : (
        <ol className="comment-threads">
          {threads.map(({ comment, replies }) => (
            <li key={comment.id} className="comment-thread">
              <CommentView comment={comment} />
              {replies.length > 0 && (
                <ol className="comment-replies">
                  {replies.map((answer) => (
                    <li key={answer.id}>
                      <CommentView comment={answer} />
                    </li>
                  ))}
                </ol>
              )}
              {mayComment &&
                (replyTo === comment.id ? (
                  <form
                    className="comment-form reply"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (await post(reply, comment.id)) {
                        setReply('');
                        setReplyTo(null);
                      }
                    }}
                  >
                    <textarea
                      rows={2}
                      maxLength={MAX_LENGTH}
                      value={reply}
                      placeholder="Reply…"
                      aria-label="Reply"
                      autoFocus
                      onChange={(event) => setReply(event.target.value)}
                    />
                    <div className="comment-actions">
                      <button type="button" className="btn ghost" onClick={() => setReplyTo(null)}>
                        Cancel
                      </button>
                      <button type="submit" className="btn primary" disabled={posting || !reply.trim()}>
                        Reply
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="comment-reply" onClick={() => setReplyTo(comment.id)}>
                    Reply
                  </button>
                ))}
            </li>
          ))}
        </ol>
      )}

      {mayComment && (
        <form
          className="comment-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await post(draft, null)) setDraft('');
          }}
        >
          <textarea
            rows={2}
            maxLength={MAX_LENGTH}
            value={draft}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="comment-actions">
            <button type="submit" className="btn primary" disabled={posting || !draft.trim()}>
              Comment
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** One comment: who, from which company, when, and what they said. */
function CommentView({ comment }) {
  return (
    <article className="comment">
      <header className="comment-head">
        <strong>{comment.author.displayName}</strong>
        {comment.author.company && <span className="muted"> · {comment.author.company}</span>}
        <time className="muted small" dateTime={comment.at}>
          {WHEN.format(new Date(comment.at))}
        </time>
      </header>
      <p className="comment-text">{comment.text}</p>
    </article>
  );
}
