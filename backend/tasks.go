package main

// The Tasks tab (spec 6): what it reads beyond the punch list's items.
//
//   GET /api/projects/{projectID}/sealed           every markup an issue locked
//   GET /api/projects/{projectID}/changes/latest   the newest change to each markup
//   GET /api/annotations/{annotationID}/changes    one item's history, every sheet
//
// All three are reads, open to anyone on the project. A markup's project is
// the prefix of its sheet id ("p12:A-101.pdf#0"), so "LIKE 'p12:%'" is the
// project — "p1:" cannot match "p12:", the colon ends the number.

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

func projectSheets(projectID int) string { return "p" + strconv.Itoa(projectID) + ":%" }

// handleProjectSealed lists every markup in the project that a flattened
// issue has made permanent, so the Tasks tab can lock tasks on drawings that
// are not open (spec 6.5). The sheet editor reads one sheet's seals; this is
// the same question asked of the whole project at once.
func handleProjectSealed(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectReader(w, r)
	if !ok {
		return
	}
	// A malformed record (a value that is not a list) contributes nothing
	// rather than failing the whole read.
	rows, err := db.Query(r.Context(),
		`SELECT DISTINCT ids.id
		 FROM export_history e
		 CROSS JOIN LATERAL jsonb_each(e.annotation_ids_by_sheet) AS s(sheet_id, list)
		 CROSS JOIN LATERAL jsonb_array_elements_text(
		   CASE WHEN jsonb_typeof(s.list) = 'array' THEN s.list ELSE '[]'::jsonb END) AS ids(id)
		 WHERE e.mode = 'flattened' AND s.sheet_id LIKE $1
		 ORDER BY ids.id`, projectSheets(projectID))
	if err != nil {
		dbError(w, "project sealed ids", err)
		return
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			dbError(w, "scan project sealed id", err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "project sealed ids rows", err)
		return
	}
	writeJSON(w, http.StatusOK, ids)
}

// handleProjectLatestChanges returns the newest change to each markup in the
// project, keyed by markup id, for the Tasks tab's "last updated" column. A
// task placed on a sheet has history on two sheets; the newest of either wins.
func handleProjectLatestChanges(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectReader(w, r)
	if !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT DISTINCT ON (annotation_id) `+changeColumns+` FROM change_history
		 WHERE sheet_id LIKE $1
		 ORDER BY annotation_id, changed_at DESC, id DESC`, projectSheets(projectID))
	if err != nil {
		dbError(w, "project latest changes", err)
		return
	}
	defer rows.Close()

	latest := map[string]ChangeRecord{}
	for rows.Next() {
		c, err := scanChange(rows.Scan)
		if err != nil {
			dbError(w, "scan project latest change", err)
			return
		}
		latest[c.AnnotationID] = c
	}
	if err := rows.Err(); err != nil {
		dbError(w, "project latest changes rows", err)
		return
	}
	writeJSON(w, http.StatusOK, latest)
}

// handleAnnotationHistory returns one item's whole history, newest first, on
// every sheet it has been on: a task made off the drawings and then placed on
// a sheet keeps what happened to it before (spec 6.4).
//
// The project is read from the item's sheet — or, for an item no longer
// stored, from the sheet of its newest change — and only that project's
// records are returned. A markup never changes project (BR-14), so the two
// can only disagree for a forged id, which then reads nothing.
func handleAnnotationHistory(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	id := r.PathValue("annotationID")

	var sheetID string
	err := db.QueryRow(r.Context(), `SELECT sheet_id FROM annotations WHERE id = $1`, id).Scan(&sheetID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = db.QueryRow(r.Context(),
			`SELECT sheet_id FROM change_history WHERE annotation_id = $1
			 ORDER BY changed_at DESC, id DESC LIMIT 1`, id).Scan(&sheetID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		jsonError(w, http.StatusNotFound, "That item has no history.")
		return
	}
	if err != nil {
		dbError(w, "find item for history", err)
		return
	}
	projectID, ok := sheetProject(sheetID)
	if !ok {
		jsonError(w, http.StatusNotFound, "That item has no history.")
		return
	}
	if _, ok := memberOf(w, r, u, projectID, false); !ok {
		return
	}

	rows, err := db.Query(r.Context(),
		`SELECT `+changeColumns+` FROM change_history
		 WHERE annotation_id = $1 AND sheet_id LIKE $2
		 ORDER BY changed_at DESC, id DESC`, id, projectSheets(projectID))
	if err != nil {
		dbError(w, "item history", err)
		return
	}
	defer rows.Close()

	list := []ChangeRecord{}
	for rows.Next() {
		c, err := scanChange(rows.Scan)
		if err != nil {
			dbError(w, "scan item history", err)
			return
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "item history rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// projectReader checks that the signed-in person is on the project named in
// the path, and returns it.
func projectReader(w http.ResponseWriter, r *http.Request) (int, bool) {
	u, ok := signedIn(w, r)
	if !ok {
		return 0, false
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return 0, false
	}
	if _, ok := memberOf(w, r, u, projectID, false); !ok {
		return 0, false
	}
	return projectID, true
}
