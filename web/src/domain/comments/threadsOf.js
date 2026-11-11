/**
 * @typedef {{ comment: import('./Comment').Comment, replies: import('./Comment').Comment[] }} CommentThread
 */

/**
 * An item's comments as threads (spec 7.1): oldest first, each reply under
 * the comment that started its thread. Replies nest one level, as they do in
 * Bluebeam — a reply to a reply joins the same thread — because a site
 * conversation is a question and its answers, not a tree.
 *
 * A reply whose comment is not in the list (it belongs to another item, or
 * the list was cut short) starts a thread of its own rather than vanishing:
 * losing what someone said is worse than showing it out of place.
 *
 * @param {import('./Comment').Comment[]} comments
 * @returns {CommentThread[]}
 */
export function threadsOf(comments) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const rootOf = (comment) => {
    let current = comment;
    const seen = new Set([current.id]);
    while (current.replyTo && byId.has(current.replyTo) && !seen.has(current.replyTo)) {
      current = byId.get(current.replyTo);
      seen.add(current.id);
    }
    return current;
  };

  const ordered = [...comments].sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));
  /** @type {Map<string, CommentThread>} */
  const threads = new Map();
  for (const comment of ordered) {
    if (rootOf(comment) === comment) threads.set(comment.id, { comment, replies: [] });
  }
  for (const comment of ordered) {
    const root = rootOf(comment);
    if (root !== comment) threads.get(root.id).replies.push(comment);
  }
  return [...threads.values()];
}
