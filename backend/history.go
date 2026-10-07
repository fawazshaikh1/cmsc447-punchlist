package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

// jsTime formats a time the way JavaScript's toISOString() does, so values
// round-trip through the frontend unchanged.
func jsTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// ChangeRecord matches the frontend's ChangeRecord.toJSON().
// Actor is stored as a snapshot (who they were at the time), not a user id.
type ChangeRecord struct {
	ID           string          `json:"id"`
	AnnotationID string          `json:"annotationId"`
	SheetID      string          `json:"sheetId"`
	Intent       string          `json:"intent"`
	Actor        json.RawMessage `json:"actor"`
	At           string          `json:"at"`
	Detail       string          `json:"detail"`
}

// ExportRecord matches the frontend's ExportRecord.toJSON().
type ExportRecord struct {
	ID                   string          `json:"id"`
	DocumentName         string          `json:"documentName"`
	Mode                 string          `json:"mode"`
	ExportedAt           string          `json:"exportedAt"`
	ExportedBy           string          `json:"exportedBy"`
	AnnotationIDsBySheet json.RawMessage `json:"annotationIdsBySheet"`
}

func dbError(w http.ResponseWriter, what string, err error) {
	log.Printf("%s: %v", what, err)
	http.Error(w, "database error", http.StatusInternalServerError)
}

// handleSheets routes everything under /api/sheets/{sheetId}/...
//
//	/annotations                          GET list, DELETE all   (existing)
//	/annotations/{annotationId}/changes   GET history, newest first
//	/changes                              POST append one change
//	/changes/latest                       GET latest change per annotation
func handleSheets(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/sheets/"), "/")
	if len(parts) < 2 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	sheetID := parts[0]

	switch {
	case len(parts) == 2 && parts[1] == "annotations":
		handleSheetAnnotations(w, r)
	case len(parts) == 4 && parts[1] == "annotations" && parts[2] != "" && parts[3] == "changes":
		listChangesForAnnotation(w, r, sheetID, parts[2])
	case len(parts) == 2 && parts[1] == "changes":
		appendChange(w, r, sheetID)
	case len(parts) == 3 && parts[1] == "changes" && parts[2] == "latest":
		latestChangesBySheet(w, r, sheetID)
	default:
		http.NotFound(w, r)
	}
}

func appendChange(w http.ResponseWriter, r *http.Request, sheetID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var c ChangeRecord
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if c.ID == "" || c.AnnotationID == "" || c.Intent == "" {
		http.Error(w, "id, annotationId and intent are required", http.StatusBadRequest)
		return
	}
	at, err := time.Parse(time.RFC3339, c.At)
	if err != nil {
		http.Error(w, "at must be an ISO-8601 timestamp", http.StatusBadRequest)
		return
	}
	if len(c.Actor) == 0 || string(c.Actor) == "null" {
		c.Actor = json.RawMessage("{}")
	}

	// Append-only: a repeated id (for example a retry after a dropped
	// connection) is ignored rather than overwritten or duplicated.
	_, err = db.Exec(r.Context(),
		`INSERT INTO change_history (id, annotation_id, sheet_id, intent, actor, changed_at, detail)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (id) DO NOTHING`,
		c.ID, c.AnnotationID, sheetID, c.Intent, []byte(c.Actor), at, c.Detail)
	if err != nil {
		dbError(w, "append change", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

const changeColumns = `id, annotation_id, sheet_id, intent, actor, changed_at, detail`

func scanChange(scan func(dest ...interface{}) error) (ChangeRecord, error) {
	var c ChangeRecord
	var at time.Time
	if err := scan(&c.ID, &c.AnnotationID, &c.SheetID, &c.Intent, &c.Actor, &at, &c.Detail); err != nil {
		return c, err
	}
	c.At = jsTime(at)
	return c, nil
}

func listChangesForAnnotation(w http.ResponseWriter, r *http.Request, sheetID, annotationID string) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT `+changeColumns+` FROM change_history
		 WHERE sheet_id = $1 AND annotation_id = $2
		 ORDER BY changed_at DESC, id DESC`, sheetID, annotationID)
	if err != nil {
		dbError(w, "list changes", err)
		return
	}
	defer rows.Close()

	list := []ChangeRecord{}
	for rows.Next() {
		c, err := scanChange(rows.Scan)
		if err != nil {
			dbError(w, "scan change", err)
			return
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list changes rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// Returns an object keyed by annotation id (a JS Map cannot travel as JSON).
func latestChangesBySheet(w http.ResponseWriter, r *http.Request, sheetID string) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT DISTINCT ON (annotation_id) `+changeColumns+` FROM change_history
		 WHERE sheet_id = $1
		 ORDER BY annotation_id, changed_at DESC, id DESC`, sheetID)
	if err != nil {
		dbError(w, "latest changes", err)
		return
	}
	defer rows.Close()

	latest := map[string]ChangeRecord{}
	for rows.Next() {
		c, err := scanChange(rows.Scan)
		if err != nil {
			dbError(w, "scan latest change", err)
			return
		}
		latest[c.AnnotationID] = c
	}
	if err := rows.Err(); err != nil {
		dbError(w, "latest changes rows", err)
		return
	}
	writeJSON(w, http.StatusOK, latest)
}

// /api/exports
//
//	POST                    append one export record
//	GET ?document=NAME      history for a document, newest first
func handleExports(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		appendExport(w, r)
	case http.MethodGet:
		listExports(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func appendExport(w http.ResponseWriter, r *http.Request) {
	var e ExportRecord
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if e.ID == "" || e.DocumentName == "" {
		http.Error(w, "id and documentName are required", http.StatusBadRequest)
		return
	}
	if e.Mode != "flattened" && e.Mode != "native" {
		http.Error(w, `mode must be "flattened" or "native"`, http.StatusBadRequest)
		return
	}
	at, err := time.Parse(time.RFC3339, e.ExportedAt)
	if err != nil {
		http.Error(w, "exportedAt must be an ISO-8601 timestamp", http.StatusBadRequest)
		return
	}
	if len(e.AnnotationIDsBySheet) == 0 || string(e.AnnotationIDsBySheet) == "null" {
		e.AnnotationIDsBySheet = json.RawMessage("{}")
	}

	_, err = db.Exec(r.Context(),
		`INSERT INTO export_history (id, document_name, mode, exported_at, exported_by, annotation_ids_by_sheet)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (id) DO NOTHING`,
		e.ID, e.DocumentName, e.Mode, at, e.ExportedBy, []byte(e.AnnotationIDsBySheet))
	if err != nil {
		dbError(w, "append export", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func listExports(w http.ResponseWriter, r *http.Request) {
	doc := r.URL.Query().Get("document")
	if doc == "" {
		http.Error(w, "document query parameter is required", http.StatusBadRequest)
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT id, document_name, mode, exported_at, exported_by, annotation_ids_by_sheet
		 FROM export_history WHERE document_name = $1
		 ORDER BY exported_at DESC, id DESC`, doc)
	if err != nil {
		dbError(w, "list exports", err)
		return
	}
	defer rows.Close()

	list := []ExportRecord{}
	for rows.Next() {
		var e ExportRecord
		var at time.Time
		if err := rows.Scan(&e.ID, &e.DocumentName, &e.Mode, &at, &e.ExportedBy, &e.AnnotationIDsBySheet); err != nil {
			dbError(w, "scan export", err)
			return
		}
		e.ExportedAt = jsTime(at)
		list = append(list, e)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list exports rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// GET /api/exports/sealed?document=NAME&sheetId=ID
// Annotation ids on that sheet that a FLATTENED export has made permanent.
func handleSealedIds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	doc := r.URL.Query().Get("document")
	sheetID := r.URL.Query().Get("sheetId")
	if doc == "" || sheetID == "" {
		http.Error(w, "document and sheetId query parameters are required", http.StatusBadRequest)
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT DISTINCT jsonb_array_elements_text(annotation_ids_by_sheet -> $2::text)
		 FROM export_history
		 WHERE document_name = $1 AND mode = 'flattened'`, doc, sheetID)
	if err != nil {
		dbError(w, "sealed ids", err)
		return
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			dbError(w, "scan sealed id", err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "sealed ids rows", err)
		return
	}
	writeJSON(w, http.StatusOK, ids)
}
