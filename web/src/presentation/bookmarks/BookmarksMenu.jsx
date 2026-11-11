import { useEffect, useId, useRef, useState } from 'react';

import { searchSheets } from '../../domain/sheets';
import './bookmarks.css';

/**
 * @typedef {{ documentName: string, pageIndex: number }} SheetPlace
 */

/**
 * Bookmarks, in the top bar (spec 7.2, SRS 4.9.7): the sheets this person
 * starred, across every drawing in the project, and a box that finds any
 * sheet by its number or title — "A-201", "a201" or "elevations". One tap
 * opens that drawing at that sheet, instead of paging through the set.
 *
 * @param {object} props
 * @param {string[]} props.starred Sheet ids, oldest first.
 * @param {(sheetId: string) => (SheetPlace & { label: string })|null} props.describe
 * @param {() => import('../../domain/sheets/searchSheets').SheetEntry[]} props.sheets
 *        Every named sheet in the project, read when the menu opens.
 * @param {(place: SheetPlace) => void} props.onGo
 */
export function BookmarksMenu({ starred, describe, sheets, onGo }) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef(null);
  const search = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    search.current?.focus();
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (place) => {
    setOpen(false);
    setQuery('');
    onGo(place);
  };

  const found = open && query.trim() ? searchSheets(sheets(), query).slice(0, 12) : [];
  const marked = starred.map((sheetId) => ({ sheetId, place: describe(sheetId) })).filter(({ place }) => place);

  return (
    <div className="bookmarks-menu" ref={root}>
      <button
        type="button"
        className="btn bookmarks-button"
        aria-expanded={open}
        aria-controls={`${ids}-panel`}
        onClick={() => setOpen((value) => !value)}
        title="Bookmarked sheets, and finding a sheet by its number"
      >
        <span aria-hidden="true">★</span>
        <span className="btn-label">Bookmarks</span>
      </button>

      {open && (
        <div className="bookmarks-panel" id={`${ids}-panel`} role="dialog" aria-label="Bookmarks">
          <input
            ref={search}
            type="search"
            className="bookmarks-search"
            placeholder="Find a sheet — e.g. A-201"
            aria-label="Find a sheet by number or title"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {query.trim() ? (
            found.length === 0 ? (
              <p className="muted small">No sheet matches “{query.trim()}”.</p>
            ) : (
              <ul className="bookmarks-list" aria-label="Sheets found">
                {found.map((sheet) => (
                  <li key={`${sheet.documentName}#${sheet.pageIndex}`}>
                    <button type="button" onClick={() => go(sheet)}>
                      <strong>{[sheet.number, sheet.title].filter(Boolean).join(' · ')}</strong>
                      <span className="muted small">{sheet.documentName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : marked.length === 0 ? (
            <p className="muted small">Star a sheet with ☆ beside the sheet picker to keep it here.</p>
          ) : (
            <ul className="bookmarks-list" aria-label="Bookmarked sheets">
              {marked.map(({ sheetId, place }) => (
                <li key={sheetId}>
                  <button type="button" onClick={() => go(place)}>
                    <strong>{place.label}</strong>
                    <span className="muted small">{place.documentName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
