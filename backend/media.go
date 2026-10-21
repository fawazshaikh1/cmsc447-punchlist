package main

// Photographs on the server (SCRUM-45), so a photo taken on one tablet is
// seen on every device on the project — and survives the tablet.
//
//	PUT    /api/media/{key}?project=ID   the image bytes, as the body
//	GET    /api/media/{key}              the image
//	DELETE /api/media/{key}
//
// The key is chosen by the browser (photo_<uuid>), because a photo is stored
// before the markup that shows it exists and the markup records the key. The
// project is given when it is uploaded and checked on every read, exactly as
// a sheet's project is for its markups.

import (
	_ "embed"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

//go:embed media_schema.sql
var mediaSchema string

// maxMediaBytes bounds an upload. Photos are downscaled to 1600px JPEGs in
// the browser first, a few hundred KB; this leaves room and stops abuse.
const maxMediaBytes = 10 << 20

// mediaKey matches the keys the browser makes, and nothing that could be a
// path or carry a query.
var mediaKey = regexp.MustCompile(`^[A-Za-z0-9_-]{1,120}$`)

// imageTypes are the formats accepted. Not SVG: an SVG is a document that can
// carry script, and serving one from our own origin would let it run as us.
var imageTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
	"image/gif":  true,
	"image/heic": true,
	"image/heif": true,
}

func mediaKeyParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	key := r.PathValue("key")
	if !mediaKey.MatchString(key) {
		jsonError(w, http.StatusNotFound, "No such photo.")
		return "", false
	}
	return key, true
}

// PUT /api/media/{key}?project=ID — stores a photo on the project.
//
// Anyone on the project may add a photo: it is the one thing a collaborator
// can create. Uploading the same key to the same project again is a no-op,
// so a retry after a dropped connection is safe; the same key on another
// project is refused rather than silently moved.
func handlePutMedia(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	key, ok := mediaKeyParam(w, r)
	if !ok {
		return
	}
	projectID, err := strconv.Atoi(r.URL.Query().Get("project"))
	if err != nil || projectID < 1 {
		jsonError(w, http.StatusBadRequest, "Say which project the photo belongs to.")
		return
	}
	role, ok := memberOf(w, r, u, projectID, false)
	if !ok {
		return
	}
	if !role.canCreate("photo") {
		jsonError(w, http.StatusForbidden, deniedEdit)
		return
	}

	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if !imageTypes[mimeType] {
		jsonError(w, http.StatusUnsupportedMediaType, "Photos must be JPEG, PNG, WebP, GIF or HEIC images.")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxMediaBytes))
	if err != nil {
		jsonError(w, http.StatusRequestEntityTooLarge, "That photo is too large.")
		return
	}
	if len(body) == 0 {
		jsonError(w, http.StatusBadRequest, "The photo was empty.")
		return
	}

	tag, err := db.Exec(r.Context(),
		`INSERT INTO media (key, project_id, mime_type, bytes, byte_size, uploaded_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (key) DO NOTHING`,
		key, projectID, mimeType, body, len(body), u.ID)
	if err != nil {
		dbError(w, "store photo", err)
		return
	}
	if tag.RowsAffected() == 0 {
		var existing int
		if err := db.QueryRow(r.Context(), `SELECT project_id FROM media WHERE key = $1`, key).Scan(&existing); err != nil {
			dbError(w, "find photo", err)
			return
		}
		if existing != projectID {
			jsonError(w, http.StatusConflict, "That photo belongs to another project.")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/media/{key} — the photo, to anyone on its project.
func handleGetMedia(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	key, ok := mediaKeyParam(w, r)
	if !ok {
		return
	}
	var projectID int
	var mimeType string
	var body []byte
	err := db.QueryRow(r.Context(),
		`SELECT project_id, mime_type, bytes FROM media WHERE key = $1`, key).
		Scan(&projectID, &mimeType, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		jsonError(w, http.StatusNotFound, "No such photo.")
		return
	}
	if err != nil {
		dbError(w, "read photo", err)
		return
	}
	if _, ok := memberOf(w, r, u, projectID, false); !ok {
		return
	}

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	// A key's bytes never change, so the browser may keep them for good —
	// but only for this person: a photo is not public.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(body)
}

// DELETE /api/media/{key} — editors only, like deleting a markup.
func handleDeleteMedia(w http.ResponseWriter, r *http.Request) {
	u, ok := signedIn(w, r)
	if !ok {
		return
	}
	key, ok := mediaKeyParam(w, r)
	if !ok {
		return
	}
	var projectID int
	err := db.QueryRow(r.Context(), `SELECT project_id FROM media WHERE key = $1`, key).Scan(&projectID)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		dbError(w, "find photo", err)
		return
	}
	role, ok := memberOf(w, r, u, projectID, false)
	if !ok {
		return
	}
	if !role.canEdit() {
		jsonError(w, http.StatusForbidden, deniedEdit)
		return
	}
	if _, err := db.Exec(r.Context(), `DELETE FROM media WHERE key = $1`, key); err != nil {
		dbError(w, "delete photo", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
