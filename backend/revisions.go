package main

// A drawing's revisions (SCRUM-90).
//
//   GET /api/projects/{projectID}/revisions                                  [link], oldest first
//   PUT /api/projects/{projectID}/documents/{documentID}/revision-of/{previousID}   admins
//
// The revised drawing is uploaded like any other (documents.go), under a name
// of its own, and then marked as replacing the one before it. The library
// shows which set is current (FR-10.5), and the open items on the old set's
// sheets can carry forward by sheet number (SCRUM-91, D7).

import (
	_ "embed"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

//go:embed revisions_schema.sql
var revisionsSchema string

func init() { registerSchema(revisionsSchema) }

// RevisionLink says one drawing replaces another.
type RevisionLink struct {
	DocumentID int    `json:"documentId"`
	RevisionOf int    `json:"revisionOf"`
	LinkedAt   string `json:"linkedAt"`
}

func handleListRevisions(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectReader(w, r)
	if !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT l.document_id, l.revision_of, l.linked_at
		 FROM document_revisions l JOIN documents d ON d.id = l.document_id
		 WHERE d.project_id = $1 ORDER BY l.linked_at, l.document_id`, projectID)
	if err != nil {
		dbError(w, "list revisions", err)
		return
	}
	defer rows.Close()
	list := []RevisionLink{}
	for rows.Next() {
		var link RevisionLink
		var at time.Time
		if err := rows.Scan(&link.DocumentID, &link.RevisionOf, &at); err != nil {
			dbError(w, "scan revision", err)
			return
		}
		link.LinkedAt = jsTime(at)
		list = append(list, link)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list revisions rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func handleLinkRevision(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return
	}
	if _, ok := memberOf(w, r, u, projectID, true); !ok {
		return
	}
	document, err1 := strconv.Atoi(r.PathValue("documentID"))
	previous, err2 := strconv.Atoi(r.PathValue("previousID"))
	if err1 != nil || err2 != nil {
		jsonError(w, http.StatusNotFound, "That drawing is not in this project.")
		return
	}
	if document == previous {
		jsonError(w, http.StatusBadRequest, "A drawing cannot be a revision of itself.")
		return
	}
	var found int
	if err := db.QueryRow(r.Context(),
		`SELECT count(*) FROM documents WHERE project_id = $1 AND id IN ($2, $3)`, projectID, document, previous).Scan(&found); err != nil {
		dbError(w, "find drawings", err)
		return
	}
	if found != 2 {
		jsonError(w, http.StatusNotFound, "That drawing is not in this project.")
		return
	}

	// Already so: saying it again changes nothing.
	var existing int
	err := db.QueryRow(r.Context(), `SELECT revision_of FROM document_revisions WHERE document_id = $1`, document).Scan(&existing)
	switch {
	case err == nil && existing == previous:
		w.WriteHeader(http.StatusNoContent)
		return
	case err == nil:
		jsonError(w, http.StatusConflict, "That drawing is already a revision of another set.")
		return
	case !errors.Is(err, pgx.ErrNoRows):
		dbError(w, "find revision", err)
		return
	}

	// No loops: the set being replaced must not itself descend from this one.
	for at, steps := previous, 0; steps < 1000; steps++ {
		var earlier int
		err := db.QueryRow(r.Context(), `SELECT revision_of FROM document_revisions WHERE document_id = $1`, at).Scan(&earlier)
		if errors.Is(err, pgx.ErrNoRows) {
			break
		}
		if err != nil {
			dbError(w, "walk revisions", err)
			return
		}
		if earlier == document {
			jsonError(w, http.StatusConflict, "That would make a drawing a revision of its own revision.")
			return
		}
		at = earlier
	}

	tag, err := db.Exec(r.Context(),
		`INSERT INTO document_revisions (document_id, revision_of, linked_by) VALUES ($1, $2, $3)
		 ON CONFLICT DO NOTHING`, document, previous, u.ID)
	if err != nil {
		dbError(w, "link revision", err)
		return
	}
	if tag.RowsAffected() == 0 {
		jsonError(w, http.StatusConflict, "That drawing already has a newer revision.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
