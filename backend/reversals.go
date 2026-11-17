package main

// Reversing the workflow after an accident (spec 8).
//
//   GET  /api/projects/{projectID}/trash    markups deleted in the last 30 days (admins)
//   GET  /api/projects/{projectID}/issues   every issued PDF, voided or not (admins)
//   POST /api/exports/{exportID}/void       { reason } — lift an issue's locks (admins)
//
// Sending a task back (8.1) needs nothing here: it is a status change, which
// the markup guards already keep to admins and power collaborators, and its
// reason is a comment, which anyone on the project may add.

import (
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

//go:embed reversals_schema.sql
var reversalsSchema string

func init() { registerSchema(reversalsSchema) }

// trashDays is how long a deleted markup can be brought back.
const trashDays = 30

// DeletedMarkup is a markup exactly as it was saved — so the browser reads it
// with the same code that reads a sheet — plus who deleted it and when.
type DeletedMarkup struct {
	Annotation
	DeletedAt string          `json:"deletedAt"`
	DeletedBy json.RawMessage `json:"deletedBy"` // the actor, or null when no record says
	// DrawingRemoved: the drawing it was on has left the project, so it would
	// come back onto a sheet nobody can open. Off-sheet tasks never are.
	DrawingRemoved bool `json:"drawingRemoved"`
}

// IssueVoid is how an issue was voided.
type IssueVoid struct {
	By     string `json:"by"`
	At     string `json:"at"`
	Reason string `json:"reason"`
}

// Issue is one flattened export, for the admin's Issue history.
type Issue struct {
	ID           string     `json:"id"`
	DocumentName string     `json:"documentName"`
	ExportedAt   string     `json:"exportedAt"`
	ExportedBy   string     `json:"exportedBy"`
	SealedCount  int        `json:"sealedCount"`
	Void         *IssueVoid `json:"void"`
}

// projectAdmin checks that the signed-in person is an admin of the project in
// the path, and returns it.
func projectAdmin(w http.ResponseWriter, r *http.Request) (int, bool) {
	u, ok := signedIn(w, r)
	if !ok {
		return 0, false
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return 0, false
	}
	if _, ok := memberOf(w, r, u, projectID, true); !ok {
		return 0, false
	}
	return projectID, true
}

// sheetDocument is the drawing a sheet id names: "p1:A set.pdf#3" is
// "A set.pdf". The page number follows the LAST '#', so a file name may
// contain one.
func sheetDocument(sheetID string) string {
	_, rest, _ := strings.Cut(sheetID, ":")
	if i := strings.LastIndex(rest, "#"); i >= 0 {
		return rest[:i]
	}
	return rest
}

// offSheetDocument is the Tasks tab's sheet for tasks on no drawing
// (web/src/domain/tasks/offSheet.js).
const offSheetDocument = "~tasks"

func handleListTrash(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectAdmin(w, r)
	if !ok {
		return
	}
	// Forgotten when read rather than by a timer: there is no scheduler to
	// keep running, and a copy nobody asks for harms nobody until then.
	if _, err := db.Exec(r.Context(),
		`DELETE FROM annotation_trash WHERE deleted_at < now() - make_interval(days => $1)`, trashDays); err != nil {
		dbError(w, "prune trash", err)
		return
	}

	drawings := map[string]bool{}
	names, err := db.Query(r.Context(), `SELECT name FROM documents WHERE project_id = $1`, projectID)
	if err != nil {
		dbError(w, "project drawings", err)
		return
	}
	for names.Next() {
		var name string
		if err := names.Scan(&name); err != nil {
			names.Close()
			dbError(w, "scan drawing name", err)
			return
		}
		drawings[name] = true
	}
	names.Close()
	if err := names.Err(); err != nil {
		dbError(w, "project drawings rows", err)
		return
	}

	// Who deleted it is the newest "delete" record for that markup — written
	// by the browser just after the delete, so it may be missing (a cleared
	// sheet records each markup, an old client may not have).
	rows, err := db.Query(r.Context(),
		`SELECT t.id, t.sheet_id, t.kind, COALESCE(t.x, 0), COALESCE(t.y, 0), t.payload, t.created_at, t.deleted_at,
		        who.actor
		 FROM annotation_trash t
		 LEFT JOIN LATERAL (
		   SELECT actor FROM change_history c
		   WHERE c.annotation_id = t.id AND c.intent = 'delete' AND c.sheet_id LIKE $1
		   ORDER BY c.changed_at DESC, c.id DESC LIMIT 1
		 ) who ON true
		 WHERE t.sheet_id LIKE $1
		   AND NOT EXISTS (SELECT 1 FROM annotations a WHERE a.id = t.id)
		 ORDER BY t.deleted_at DESC, t.id`, projectSheets(projectID))
	if err != nil {
		dbError(w, "list trash", err)
		return
	}
	defer rows.Close()

	list := []DeletedMarkup{}
	for rows.Next() {
		var d DeletedMarkup
		var created, deleted time.Time
		var actor []byte
		if err := rows.Scan(&d.ID, &d.SheetID, &d.Kind, &d.X, &d.Y, &d.Payload, &created, &deleted, &actor); err != nil {
			dbError(w, "scan trash", err)
			return
		}
		d.CreatedAt = created.UTC().Format(time.RFC3339)
		d.DeletedAt = jsTime(deleted)
		d.DeletedBy = json.RawMessage("null")
		if len(actor) > 0 {
			d.DeletedBy = actor
		}
		document := sheetDocument(d.SheetID)
		d.DrawingRemoved = document != offSheetDocument && !drawings[document]
		list = append(list, d)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list trash rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func handleListIssues(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectAdmin(w, r)
	if !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT e.id, e.document_name, e.exported_at, e.exported_by, e.annotation_ids_by_sheet,
		        v.voided_by, v.voided_at, v.reason
		 FROM export_history e
		 LEFT JOIN export_voids v ON v.export_id = e.id
		 WHERE e.project_id = $1 AND e.mode = 'flattened'
		 ORDER BY e.exported_at DESC, e.id DESC`, projectID)
	if err != nil {
		dbError(w, "list issues", err)
		return
	}
	defer rows.Close()

	list := []Issue{}
	for rows.Next() {
		var issue Issue
		var exported time.Time
		var bySheet []byte
		var voidedBy, reason *string
		var voidedAt *time.Time
		if err := rows.Scan(&issue.ID, &issue.DocumentName, &exported, &issue.ExportedBy, &bySheet, &voidedBy, &voidedAt, &reason); err != nil {
			dbError(w, "scan issue", err)
			return
		}
		issue.ExportedAt = jsTime(exported)
		issue.SealedCount = sealedCount(bySheet)
		if voidedAt != nil {
			issue.Void = &IssueVoid{By: deref(voidedBy), At: jsTime(*voidedAt), Reason: deref(reason)}
		}
		list = append(list, issue)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list issues rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleVoidIssue lifts an issue's locks (spec 8.3). Only an admin of the
// project the export belongs to may, with a reason; the issue stays in the
// log. Markups a later issue also holds stay locked by that issue.
func handleVoidIssue(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	exportID := r.PathValue("exportID")

	var projectID *int
	var mode string
	var bySheet []byte
	err := db.QueryRow(r.Context(),
		`SELECT project_id, mode, annotation_ids_by_sheet FROM export_history WHERE id = $1`, exportID).
		Scan(&projectID, &mode, &bySheet)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonError(w, http.StatusNotFound, "That issue does not exist.")
		return
	}
	if err != nil {
		dbError(w, "find issue", err)
		return
	}
	// Older records carry no project; their sheets name it.
	project := 0
	if projectID != nil {
		project = *projectID
	} else {
		var sheets map[string]json.RawMessage
		_ = json.Unmarshal(bySheet, &sheets)
		for sheetID := range sheets {
			if p, ok := sheetProject(sheetID); ok {
				project = p
				break
			}
		}
	}
	if project == 0 {
		jsonError(w, http.StatusForbidden, "This issue is not part of a project.")
		return
	}
	role, ok := memberOf(w, r, u, project, true)
	if !ok {
		return
	}
	if mode != "flattened" {
		jsonError(w, http.StatusBadRequest, "Only an issued PDF locks markups, so only one can be voided.")
		return
	}

	raw, ok := readBody(w, r, 64<<10)
	if !ok {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		jsonError(w, http.StatusBadRequest, "The request was not valid JSON.")
		return
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		jsonError(w, http.StatusBadRequest, "Say why the issue is being voided.")
		return
	}
	if utf8.RuneCountInString(reason) > maxCommentLength {
		jsonError(w, http.StatusBadRequest, "The reason is too long.")
		return
	}

	tag, err := db.Exec(r.Context(),
		`INSERT INTO export_voids (export_id, voided_by, voided_by_user, reason)
		 VALUES ($1, $2, $3, $4) ON CONFLICT (export_id) DO NOTHING`,
		exportID, actorFor(u, role).String(), u.ID, reason)
	if err != nil {
		dbError(w, "void issue", err)
		return
	}
	if tag.RowsAffected() == 0 {
		jsonError(w, http.StatusConflict, "That issue was already voided.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sealedCount is how many markups an export lists across its sheets.
func sealedCount(bySheet []byte) int {
	var sheets map[string][]string
	if json.Unmarshal(bySheet, &sheets) != nil {
		return 0
	}
	n := 0
	for _, ids := range sheets {
		n += len(ids)
	}
	return n
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
