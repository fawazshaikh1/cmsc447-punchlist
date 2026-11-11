import './bookmarks.css';

/**
 * ★ beside the sheet picker: bookmarks the sheet on screen, or lets it go
 * (spec 7.2).
 *
 * @param {object} props
 * @param {boolean} props.starred
 * @param {() => void} props.onToggle
 */
export function BookmarkStar({ starred, onToggle }) {
  return (
    <button
      type="button"
      className={starred ? 'bookmark-star on' : 'bookmark-star'}
      aria-pressed={starred}
      aria-label={starred ? 'Remove this sheet from your bookmarks' : 'Bookmark this sheet'}
      title={starred ? 'Remove this sheet from your bookmarks' : 'Bookmark this sheet'}
      onClick={onToggle}
    >
      <span aria-hidden="true">{starred ? '★' : '☆'}</span>
    </button>
  );
}
