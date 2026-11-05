package main

// Sheet names (spec 5.2): what each page of a drawing is called, kept with
// the drawing so a punch list, a bookmark or the sheet picker says "A-101"
// on every device — and says the same thing on all of them.
//
//	GET /api/projects/{projectID}/sheet-names                 every drawing's names
//	PUT /api/projects/{projectID}/sheet-names/{documentName}  save one drawing's
//
// Names arrive two ways. An editor's browser reads them from the title blocks
// the first time it opens a drawing and sends them as 'detected': those fill
// pages with no name and never replace one, so a second device reading the
// same drawing changes nothing. An admin who corrects a reading sends it as
// 'edited', which replaces whatever the page had — and, being stored, is then
// safe from every later reading.
//
// Anyone on the project may read them. Saving a reading takes an admin or a
// power collaborator — the people who mark drawings up; renaming takes an
// admin, who owns the project's drawings (FR-10.4).

import (
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

//go:embed sheet_names_schema.sql
var sheetNamesSchema string

func init() { registerSchema(sheetNamesSchema) }

// SheetName is one page's number and title, as the frontend's SheetName
// serialises it.
type SheetName struct {
	PageIndex int    `json:"pageIndex"`
	Number    string `json:"number"`
	Title     string `json:"title"`
	Source    string `json:"source,omitempty"`
}

const (
	maxSheetNumber    = 40
	maxSheetTitle     = 120
	maxSheetNamesSent = 2000
	sourceDetected    = "detected"
	sourceEdited      = "edited"
)

// GET /api/projects/{projectID}/sheet-names — { drawing name: [names by page] }.
// One call for the whole project, because the punch list spans its drawings.
func handleListSheetNames(w http.ResponseWriter, r *http.Request) {
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
		`SELECT d.name, s.page_index, s.number, s.title, s.source
		 FROM sheet_names s JOIN documents d ON d.id = s.document_id
		 WHERE d.project_id = $1
		 ORDER BY d.name, s.page_index`, projectID)
	if err != nil {
		dbError(w, "list sheet names", err)
		return
	}
	defer rows.Close()

	byDrawing := map[string][]SheetName{}
	for rows.Next() {
		var drawing string
		var name SheetName
		if err := rows.Scan(&drawing, &name.PageIndex, &name.Number, &name.Title, &name.Source); err != nil {
			dbError(w, "scan sheet name", err)
			return
		}
		byDrawing[drawing] = append(byDrawing[drawing], name)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "sheet name rows", err)
		return
	}
	writeJSON(w, http.StatusOK, byDrawing)
}

// PUT /api/projects/{projectID}/sheet-names/{documentName} — saves a reading
// of the drawing ('detected') or an admin's rename ('edited'), then answers
// with the drawing's names as they now stand.
func handleSaveSheetNames(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	projectID, ok := projectIDParam(w, r)
	if !ok {
		return
	}
	role, ok := memberOf(w, r, u, projectID, false)
	if !ok {
		return
	}
	drawing, ok := documentName(r.PathValue("documentName"))
	if !ok {
		jsonError(w, http.StatusBadRequest, "Give the drawing's file name, without slashes.")
		return
	}

	raw, ok := readBody(w, r, 256<<10)
	if !ok {
		return
	}
	var in struct {
		Source string      `json:"source"`
		Names  []SheetName `json:"names"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		jsonError(w, http.StatusBadRequest, "The request was not valid JSON.")
		return
	}

	switch in.Source {
	case sourceDetected:
		if !role.canEdit() {
			jsonError(w, http.StatusForbidden, deniedEdit)
			return
		}
	case sourceEdited:
		if role != RoleAdmin {
			jsonError(w, http.StatusForbidden, "Only a project admin can rename a sheet.")
			return
		}
	default:
		jsonError(w, http.StatusBadRequest, `A sheet name is either "detected" or "edited".`)
		return
	}

	names, problem := checkedSheetNames(in.Names)
	if problem != "" {
		jsonError(w, http.StatusBadRequest, problem)
		return
	}

	var documentID int
	err := db.QueryRow(r.Context(),
		`SELECT id FROM documents WHERE project_id = $1 AND name = $2`, projectID, drawing).Scan(&documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonError(w, http.StatusNotFound, "No drawing called "+drawing+" in this project.")
		return
	}
	if err != nil {
		dbError(w, "find drawing", err)
		return
	}

	if len(names) > 0 {
		pages := make([]int, len(names))
		numbers := make([]string, len(names))
		titles := make([]string, len(names))
		for i, name := range names {
			pages[i], numbers[i], titles[i] = name.PageIndex, name.Number, name.Title
		}
		// A reading fills gaps and nothing else; a rename replaces.
		onConflict := `DO NOTHING`
		if in.Source == sourceEdited {
			onConflict = `DO UPDATE SET number = EXCLUDED.number, title = EXCLUDED.title,
			              source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now()`
		}
		if _, err := db.Exec(r.Context(),
			`INSERT INTO sheet_names (document_id, page_index, number, title, source, updated_by)
			 SELECT $1, p, n, t, $5, $6 FROM unnest($2::int[], $3::text[], $4::text[]) AS x(p, n, t)
			 ON CONFLICT (document_id, page_index) `+onConflict,
			documentID, pages, numbers, titles, in.Source, u.ID); err != nil {
			dbError(w, "save sheet names", err)
			return
		}
	}

	rows, err := db.Query(r.Context(),
		`SELECT page_index, number, title, source FROM sheet_names
		 WHERE document_id = $1 ORDER BY page_index`, documentID)
	if err != nil {
		dbError(w, "read sheet names", err)
		return
	}
	defer rows.Close()
	saved := []SheetName{}
	for rows.Next() {
		var name SheetName
		if err := rows.Scan(&name.PageIndex, &name.Number, &name.Title, &name.Source); err != nil {
			dbError(w, "scan sheet name", err)
			return
		}
		saved = append(saved, name)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "sheet name rows", err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

// checkedSheetNames trims each name and refuses what the table should never
// hold. One name per page: a later one in the same request wins, as it does
// in the frontend's SheetNames — and as Postgres requires, since one INSERT
// may not update the same row twice.
func checkedSheetNames(in []SheetName) ([]SheetName, string) {
	if len(in) > maxSheetNamesSent {
		return nil, "Too many sheet names in one request."
	}
	byPage := map[int]int{}
	out := []SheetName{}
	for _, name := range in {
		name.Number = strings.TrimSpace(name.Number)
		name.Title = strings.TrimSpace(name.Title)
		switch {
		case name.PageIndex < 0:
			return nil, "A sheet's page number cannot be negative."
		case utf8.RuneCountInString(name.Number) > maxSheetNumber:
			return nil, "A sheet number is at most 40 characters."
		case utf8.RuneCountInString(name.Title) > maxSheetTitle:
			return nil, "A sheet title is at most 120 characters."
		}
		if at, seen := byPage[name.PageIndex]; seen {
			out[at] = name
			continue
		}
		byPage[name.PageIndex] = len(out)
		out = append(out, name)
	}
	return out, ""
}
