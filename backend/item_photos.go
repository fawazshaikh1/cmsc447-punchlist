package main

// Photos attached to a punch item (SCRUM-88).
//
//   GET    /api/annotations/{annotationID}/photos   [photo], oldest first
//   POST   /api/annotations/{annotationID}/photos   { id, media, caption } — anyone on the project
//   GET    /api/projects/{projectID}/item-photos     { item id: [photo] }, for the issued PDF
//   DELETE /api/item-photos/{photoID}                whoever added it, or an editor
//
// The bytes are already in `media` (media.go); a photo here points at them
// and says which item it shows, who added it and when.

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

//go:embed item_photos_schema.sql
var itemPhotosSchema string

func init() { registerSchema(itemPhotosSchema) }

const maxPhotoCaption = 200

// ItemPhoto is one photo on one item.
type ItemPhoto struct {
	ID           string          `json:"id"`
	AnnotationID string          `json:"annotationId"`
	Media        json.RawMessage `json:"media"`
	Caption      string          `json:"caption"`
	AddedBy      json.RawMessage `json:"addedBy"`
	AddedAt      string          `json:"addedAt"`
}

const itemPhotoColumns = `id, annotation_id, media, caption, added_by, added_at`

func scanItemPhoto(scan func(dest ...interface{}) error) (ItemPhoto, error) {
	var p ItemPhoto
	var media, by []byte
	var at time.Time
	if err := scan(&p.ID, &p.AnnotationID, &media, &p.Caption, &by, &at); err != nil {
		return p, err
	}
	p.Media, p.AddedBy, p.AddedAt = media, by, jsTime(at)
	return p, nil
}

// itemProject is the project of the item in the path, which must exist, and
// the signed-in person's role on it.
func itemProject(w http.ResponseWriter, r *http.Request, u *User) (string, int, Role, bool) {
	id := r.PathValue("annotationID")
	var sheetID string
	err := db.QueryRow(r.Context(), `SELECT sheet_id FROM annotations WHERE id = $1`, id).Scan(&sheetID)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonError(w, http.StatusNotFound, "That item no longer exists.")
		return "", 0, "", false
	}
	if err != nil {
		dbError(w, "find item", err)
		return "", 0, "", false
	}
	projectID, ok := sheetProject(sheetID)
	if !ok {
		jsonError(w, http.StatusNotFound, "That item no longer exists.")
		return "", 0, "", false
	}
	role, ok := memberOf(w, r, u, projectID, false)
	return id, projectID, role, ok
}

func handleItemPhotos(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	id, projectID, _, ok := itemProject(w, r, u)
	if !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT `+itemPhotoColumns+` FROM item_photos
		 WHERE annotation_id = $1 AND project_id = $2 ORDER BY added_at, id`, id, projectID)
	if err != nil {
		dbError(w, "item photos", err)
		return
	}
	defer rows.Close()
	list := []ItemPhoto{}
	for rows.Next() {
		p, err := scanItemPhoto(rows.Scan)
		if err != nil {
			dbError(w, "scan item photo", err)
			return
		}
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "item photos rows", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func handleProjectItemPhotos(w http.ResponseWriter, r *http.Request) {
	projectID, ok := projectReader(w, r)
	if !ok {
		return
	}
	rows, err := db.Query(r.Context(),
		`SELECT `+itemPhotoColumns+` FROM item_photos WHERE project_id = $1 ORDER BY annotation_id, added_at, id`, projectID)
	if err != nil {
		dbError(w, "project item photos", err)
		return
	}
	defer rows.Close()
	byItem := map[string][]ItemPhoto{}
	for rows.Next() {
		p, err := scanItemPhoto(rows.Scan)
		if err != nil {
			dbError(w, "scan project item photo", err)
			return
		}
		byItem[p.AnnotationID] = append(byItem[p.AnnotationID], p)
	}
	if err := rows.Err(); err != nil {
		dbError(w, "project item photos rows", err)
		return
	}
	writeJSON(w, http.StatusOK, byItem)
}

func handleAddItemPhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	id, projectID, role, ok := itemProject(w, r, u)
	if !ok {
		return
	}
	raw, ok := readBody(w, r, 64<<10)
	if !ok {
		return
	}
	var in struct {
		ID      string          `json:"id"`
		Media   json.RawMessage `json:"media"`
		Caption string          `json:"caption"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		jsonError(w, http.StatusBadRequest, "The request was not valid JSON.")
		return
	}
	var media struct {
		Key string `json:"key"`
	}
	_ = json.Unmarshal(in.Media, &media)
	caption := strings.TrimSpace(in.Caption)
	switch {
	case in.ID == "" || len(in.ID) > 100:
		jsonError(w, http.StatusBadRequest, "A photo needs an id.")
		return
	case utf8.RuneCountInString(caption) > maxPhotoCaption:
		jsonError(w, http.StatusBadRequest, "A caption is at most 200 characters.")
		return
	}
	// Only a photo uploaded to this project: otherwise a key from another
	// project would show its photo here.
	var inProject bool
	if err := db.QueryRow(r.Context(),
		`SELECT EXISTS (SELECT 1 FROM media WHERE key = $1 AND project_id = $2)`, media.Key, projectID).Scan(&inProject); err != nil {
		dbError(w, "find photo", err)
		return
	}
	if media.Key == "" || !inProject {
		jsonError(w, http.StatusBadRequest, "That photo is not in this project.")
		return
	}

	by, _ := json.Marshal(actorFor(u, role))
	row := db.QueryRow(r.Context(),
		`INSERT INTO item_photos (id, project_id, annotation_id, media, caption, added_by, added_by_user)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (id) DO NOTHING
		 RETURNING `+itemPhotoColumns,
		in.ID, projectID, id, []byte(in.Media), caption, by, u.ID)
	added, err := scanItemPhoto(row.Scan)
	if err == nil {
		writeJSON(w, http.StatusCreated, added)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		dbError(w, "add item photo", err)
		return
	}
	// Sent again — a retry. What is stored stands.
	existing, err := scanItemPhoto(db.QueryRow(r.Context(),
		`SELECT `+itemPhotoColumns+` FROM item_photos WHERE id = $1 AND project_id = $2`, in.ID, projectID).Scan)
	if err != nil {
		jsonError(w, http.StatusConflict, "That photo id is already in use.")
		return
	}
	writeJSON(w, http.StatusOK, existing)
}

func handleRemoveItemPhoto(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	id := r.PathValue("photoID")
	var projectID int
	var addedBy *int
	err := db.QueryRow(r.Context(), `SELECT project_id, added_by_user FROM item_photos WHERE id = $1`, id).Scan(&projectID, &addedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonError(w, http.StatusNotFound, "That photo was already removed.")
		return
	}
	if err != nil {
		dbError(w, "find item photo", err)
		return
	}
	role, ok := memberOf(w, r, u, projectID, false)
	if !ok {
		return
	}
	if !role.canEdit() && (addedBy == nil || *addedBy != u.ID) {
		jsonError(w, http.StatusForbidden, "Only whoever added a photo, or an admin or power collaborator, can remove it.")
		return
	}
	if _, err := db.Exec(r.Context(), `DELETE FROM item_photos WHERE id = $1`, id); err != nil {
		dbError(w, "remove item photo", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
