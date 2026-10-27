package main

// Drawings on the server (FR-10.1 to 10.4): each project keeps the PDFs it
// works on, so a drawing opened on one device can be opened on any other by
// anyone on the project — the way a file is uploaded once and then opened
// in Acrobat's file view.
//
//	GET    /api/projects/{projectID}/documents                 the library
//	POST   /api/projects/{projectID}/documents?name=A-101.pdf  the PDF, as the body
//	GET    /api/projects/{projectID}/documents/{documentID}    the PDF
//	DELETE /api/projects/{projectID}/documents/{documentID}
//
// A drawing is known by its file name within the project, because sheets are
// named after it: the markups on p3:A-101.pdf#0 belong to the drawing called
// A-101.pdf. Uploading the same file again is a no-op, so the browser can
// offer every drawing it opens without asking first; a DIFFERENT file under a
// name already taken is refused, since its pages would inherit markups placed
// on another drawing. Carrying markups across a revised set is FR-1.5.
//
// Anyone on the project may open a drawing. Only an admin adds or deletes one
// (FR-10.4) — a drawing set is the project's record, not one person's.

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

//go:embed documents_schema.sql
var documentsSchema string

func init() { registerSchema(documentsSchema) }

// maxDocumentBytes bounds an upload. A 300-sheet vector set is typically
// 20–80 MB; this leaves room without letting one request exhaust memory.
const maxDocumentBytes = 150 << 20

// Document is one drawing in a project's library, without its bytes.
type Document struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	ByteSize   int    `json:"byteSize"`
	UploadedBy string `json:"uploadedBy"`
	UploadedAt string `json:"uploadedAt"`
}

// documentName accepts a file name as the browser reports it. Not a path, and
// nothing that could not be shown back to a person as it is.
func documentName(raw string) (string, bool) {
	name := strings.TrimSpace(raw)
	if name == "" || len(name) > 200 || !utf8.ValidString(name) {
		return "", false
	}
	if strings.ContainsAny(name, "/\\#") {
		return "", false
	}
	for _, c := range name {
		if c < 0x20 || c == 0x7f {
			return "", false
		}
	}
	return name, true
}

const documentColumns = `d.id, d.name, d.byte_size, COALESCE(u.display_name, ''), d.uploaded_at`

func scanDocument(row pgx.Row) (Document, error) {
	var d Document
	var at time.Time
	err := row.Scan(&d.ID, &d.Name, &d.ByteSize, &d.UploadedBy, &at)
	d.UploadedAt = at.UTC().Format(time.RFC3339)
	return d, err
}

// GET /api/projects/{projectID}/documents — newest first.
func handleListDocuments(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return
	}
	if _, ok := memberOf(w, r, u, projectID, false); !ok {
		return
	}

	rows, err := db.Query(r.Context(),
		`SELECT `+documentColumns+`
		 FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
		 WHERE d.project_id = $1
		 ORDER BY d.uploaded_at DESC, d.id DESC`, projectID)
	if err != nil {
		dbError(w, "list documents", err)
		return
	}
	defer rows.Close()

	list := []Document{}
	for rows.Next() {
		d, err := scanDocument(rows)
		if err != nil {
			dbError(w, "read document", err)
			return
		}
		list = append(list, d)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "list documents", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// POST /api/projects/{projectID}/documents?name=… — adds a drawing.
//
// 201 with the new drawing; 200 with the existing one when the same file is
// already there under that name; 409 when another file has the name.
func handleAddDocument(w http.ResponseWriter, r *http.Request) {
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
	name, ok := documentName(r.URL.Query().Get("name"))
	if !ok {
		jsonError(w, http.StatusBadRequest, "Give the drawing a file name, without slashes.")
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDocumentBytes))
	if err != nil {
		jsonError(w, http.StatusRequestEntityTooLarge, "That drawing is too large to store (150 MB at most).")
		return
	}
	if len(body) == 0 {
		jsonError(w, http.StatusBadRequest, "The drawing was empty.")
		return
	}
	// The bytes decide, not the Content-Type a browser guessed from the name.
	// A PDF's header may follow a little junk, but not much (ISO 32000-1 §7.5.2).
	if !bytes.Contains(body[:min(len(body), 1024)], []byte("%PDF-")) {
		jsonError(w, http.StatusUnsupportedMediaType, "Only PDF drawings can be added.")
		return
	}
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])

	row := db.QueryRow(r.Context(),
		`WITH added AS (
		   INSERT INTO documents (project_id, name, sha256, bytes, byte_size, uploaded_by)
		   VALUES ($1, $2, $3, $4, $5, $6)
		   ON CONFLICT (project_id, name) DO NOTHING
		   RETURNING id, name, byte_size, uploaded_by, uploaded_at
		 )
		 SELECT d.id, d.name, d.byte_size, COALESCE(u.display_name, ''), d.uploaded_at
		 FROM added d LEFT JOIN users u ON u.id = d.uploaded_by`,
		projectID, name, digest, body, len(body), u.ID)
	added, err := scanDocument(row)
	if err == nil {
		writeJSON(w, http.StatusCreated, added)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		dbError(w, "store document", err)
		return
	}

	// The name is taken. The same file again is a retry, or a second device
	// offering what is already there; anything else would be a different
	// drawing wearing this one's markups.
	var existingDigest string
	if err := db.QueryRow(r.Context(),
		`SELECT sha256 FROM documents WHERE project_id = $1 AND name = $2`,
		projectID, name).Scan(&existingDigest); err != nil {
		dbError(w, "find document", err)
		return
	}
	existing, err := scanDocument(db.QueryRow(r.Context(),
		`SELECT `+documentColumns+`
		 FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
		 WHERE d.project_id = $1 AND d.name = $2`, projectID, name))
	if err != nil {
		dbError(w, "find document", err)
		return
	}
	if existingDigest != digest {
		jsonError(w, http.StatusConflict,
			"This project already has a different drawing called "+name+". Rename the file to add it as well.")
		return
	}
	writeJSON(w, http.StatusOK, existing)
}

// documentInProject reads {documentID} and answers 404 unless it is in the
// project — a drawing in another project is not reachable through this one.
func documentInProject(w http.ResponseWriter, r *http.Request, projectID int) (int, bool) {
	id, err := strconv.Atoi(r.PathValue("documentID"))
	if err != nil || id < 1 {
		jsonError(w, http.StatusNotFound, "No such drawing.")
		return 0, false
	}
	var found int
	err = db.QueryRow(r.Context(),
		`SELECT id FROM documents WHERE id = $1 AND project_id = $2`, id, projectID).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonError(w, http.StatusNotFound, "No such drawing.")
		return 0, false
	}
	if err != nil {
		dbError(w, "find document", err)
		return 0, false
	}
	return id, true
}

// GET /api/projects/{projectID}/documents/{documentID} — the PDF itself.
func handleGetDocument(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return
	}
	if _, ok := memberOf(w, r, u, projectID, false); !ok {
		return
	}
	id, ok := documentInProject(w, r, projectID)
	if !ok {
		return
	}

	var name string
	var body []byte
	if err := db.QueryRow(r.Context(),
		`SELECT name, bytes FROM documents WHERE id = $1`, id).Scan(&name, &body); err != nil {
		dbError(w, "read document", err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	// A stored drawing never changes under its id, but it is not public.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(body)
}

// DELETE /api/projects/{projectID}/documents/{documentID} — admins only.
//
// Removes the file from the library. The markups made on it stay, filed
// under its name, so adding the same drawing back brings them with it.
func handleDeleteDocument(w http.ResponseWriter, r *http.Request) {
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
	id, ok := documentInProject(w, r, projectID)
	if !ok {
		return
	}
	if _, err := db.Exec(r.Context(), `DELETE FROM documents WHERE id = $1`, id); err != nil {
		dbError(w, "delete document", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
