package main

// Sheet bookmarks (spec 7.2): a star on a sheet, seen only by the person who
// put it there, on any device.
//
//   GET    /api/projects/{projectID}/bookmarks             [bookmark], oldest first
//   PUT    /api/projects/{projectID}/bookmarks/{sheetID}   star (again is harmless)
//   DELETE /api/projects/{projectID}/bookmarks/{sheetID}   unstar (again is harmless)

import (
	_ "embed"
	"net/http"
	"time"
)

//go:embed bookmarks_schema.sql
var bookmarksSchema string

func init() { registerSchema(bookmarksSchema) }

type Bookmark struct {
	SheetID   string `json:"sheetId"`
	CreatedAt string `json:"createdAt"`
}

// bookmarker is the signed-in member and the project in the path.
func bookmarker(w http.ResponseWriter, r *http.Request) (*User, int, bool) {
	u, ok := signedIn(w, r)
	if !ok {
		return nil, 0, false
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return nil, 0, false
	}
	if _, ok := memberOf(w, r, u, projectID, false); !ok {
		return nil, 0, false
	}
	return u, projectID, true
}

// bookmarkedSheet is the sheet in the path, which must be in the project.
func bookmarkedSheet(w http.ResponseWriter, r *http.Request, projectID int) (string, bool) {
	sheetID := r.PathValue("sheetID")
	if owner, ok := sheetProject(sheetID); !ok || owner != projectID {
		jsonError(w, http.StatusBadRequest, "That sheet is not in this project.")
		return "", false
	}
	return sheetID, true
}

func handleListBookmarks(w http.ResponseWriter, r *http.Request) {
	u, projectID, ok := bookmarker(w, r)
	if !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT sheet_id, created_at FROM sheet_bookmarks
		 WHERE user_id = $1 AND project_id = $2 ORDER BY created_at, sheet_id`, u.ID, projectID)
	if err != nil {
		dbError(w, "list bookmarks", err)
		return
	}
	defer rows.Close()
	list := []Bookmark{}
	for rows.Next() {
		var b Bookmark
		var at time.Time
		if err := rows.Scan(&b.SheetID, &at); err != nil {
			dbError(w, "scan bookmark", err)
			return
		}
		b.CreatedAt = jsTime(at)
		list = append(list, b)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list bookmarks rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func handleAddBookmark(w http.ResponseWriter, r *http.Request) {
	u, projectID, ok := bookmarker(w, r)
	if !ok {
		return
	}
	sheetID, ok := bookmarkedSheet(w, r, projectID)
	if !ok {
		return
	}
	if _, err := db.Exec(r.Context(),
		`INSERT INTO sheet_bookmarks (user_id, project_id, sheet_id) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, sheet_id) DO NOTHING`, u.ID, projectID, sheetID); err != nil {
		dbError(w, "add bookmark", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleRemoveBookmark(w http.ResponseWriter, r *http.Request) {
	u, projectID, ok := bookmarker(w, r)
	if !ok {
		return
	}
	sheetID, ok := bookmarkedSheet(w, r, projectID)
	if !ok {
		return
	}
	if _, err := db.Exec(r.Context(),
		`DELETE FROM sheet_bookmarks WHERE user_id = $1 AND project_id = $2 AND sheet_id = $3`,
		u.ID, projectID, sheetID); err != nil {
		dbError(w, "remove bookmark", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
