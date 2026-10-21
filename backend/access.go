package main

// Who may do what to the markups (SCRUM-46).
//
// The markup, history and export handlers in main.go and history.go were
// written before accounts existed and know nothing about them. Rather than
// thread permission checks through each one, every route is wrapped here: the
// wrapper works out the project, checks the signed-in person's role on it,
// and only then hands the request to the handler. A handler that is never
// reached cannot leak or change anything.
//
// ---------------------------------------------------------------------------
// HOW A SHEET BELONGS TO A PROJECT
// ---------------------------------------------------------------------------
// The browser names each sheet "p{projectId}:{file name}#{page}" — see
// web/src/domain/projects/SheetScope.js. The project is part of the id, so it
// is known from the URL alone, two projects can both have an "A-101.pdf"
// without colliding, and a sheet can never be claimed by another project. An
// id without the prefix (saved before projects existed) belongs to no project
// and nobody can reach it through the API.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// THE PERMISSION MODEL, IN FULL
// ---------------------------------------------------------------------------
// Mirrors RoleEditPolicy in the frontend, which hides what the server would
// refuse. The server is the one that counts: the browser's copy is a
// courtesy, and anyone can send requests without the browser.

// canEdit: move, resize, change, delete, clear a sheet, issue a flattened PDF.
func (r Role) canEdit() bool { return r == RoleAdmin || r == RolePower }

// collaboratorKinds are the markups a collaborator may add. Photos only:
// "adds photos and comments, cannot move, delete or change the status of an
// item". Comments do not exist yet; when they do, they are change records
// with intent "comment", which a collaborator may already append.
var collaboratorKinds = map[string]bool{"photo": true}

// canCreate: add a new markup of this kind.
func (r Role) canCreate(kind string) bool {
	return r.canEdit() || (r == RoleCollaborator && collaboratorKinds[kind])
}

// Change intents anyone on the project may record. Every other intent
// describes an edit, so recording it needs edit rights.
var memberIntents = map[string]bool{"create": true, "comment": true}

const deniedEdit = "Your role on this project does not allow that change. Ask a project admin if you need wider access."

// sheetProject reads the project out of a sheet id.
func sheetProject(sheetID string) (int, bool) {
	rest, ok := strings.CutPrefix(sheetID, "p")
	if !ok {
		return 0, false
	}
	digits, name, ok := strings.Cut(rest, ":")
	if !ok || name == "" || digits == "" {
		return 0, false
	}
	id, err := strconv.Atoi(digits)
	if err != nil || id < 1 || strconv.Itoa(id) != digits {
		return 0, false
	}
	return id, true
}

// --- request context ---------------------------------------------------------

type callerKey struct{}

// Caller is who is making the request and, when it concerns one project,
// their role on it. Put on the request by the guards for the handlers that
// need it.
type Caller struct {
	User      *User
	ProjectID int
	Role      Role
}

func withCaller(r *http.Request, c *Caller) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), callerKey{}, c))
}

func callerOf(ctx context.Context) *Caller {
	c, _ := ctx.Value(callerKey{}).(*Caller)
	return c
}

// sheetRole answers 403 itself unless the user is on the sheet's project.
func sheetRole(w http.ResponseWriter, r *http.Request, u *User, sheetID string) (int, Role, bool) {
	projectID, ok := sheetProject(sheetID)
	if !ok {
		jsonError(w, http.StatusForbidden, "This sheet is not part of a project. Open it from inside a project.")
		return 0, "", false
	}
	role, ok := memberOf(w, r, u, projectID, false)
	return projectID, role, ok
}

// readBody takes the whole body (up to limit) so it can be inspected and then
// handed on unchanged.
func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		jsonError(w, http.StatusRequestEntityTooLarge, "The request is too large.")
		return nil, false
	}
	return raw, true
}

func replaceBody(r *http.Request, raw []byte) {
	r.Body = io.NopCloser(bytes.NewReader(raw))
	r.ContentLength = int64(len(raw))
}

// --- guards ------------------------------------------------------------------

// requireAppRequest refuses any state-changing request that does not carry
// X-Punchlist-Request: 1. Browsers will not let another site add a custom
// header without the server's permission (a CORS preflight, which withCORS
// does not grant for this header), so this plus the SameSite cookie stops a
// malicious page from making changes as the signed-in user.
func requireAppRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if r.Header.Get("X-Punchlist-Request") != "1" {
				jsonError(w, http.StatusForbidden, "Request refused: it did not come from the Punch List app.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// guardSheets protects everything under /api/sheets/{sheetId}/.
//
// Reading needs only membership. Clearing a sheet needs edit rights. A change
// record is stamped with the signed-in person before it is stored, whatever
// the browser put in it.
func guardSheets(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := signedIn(w, r)
		if !ok {
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/sheets/"), "/")
		if len(parts) < 2 || parts[0] == "" {
			http.NotFound(w, r)
			return
		}
		projectID, role, ok := sheetRole(w, r, u, parts[0])
		if !ok {
			return
		}

		clearing := len(parts) == 2 && parts[1] == "annotations" && r.Method == http.MethodDelete
		if clearing && !role.canEdit() {
			jsonError(w, http.StatusForbidden, deniedEdit)
			return
		}

		appending := len(parts) == 2 && parts[1] == "changes" && r.Method == http.MethodPost
		if appending && !stampChange(w, r, u, role) {
			return
		}

		next(w, withCaller(r, &Caller{User: u, ProjectID: projectID, Role: role}))
	}
}

// stampChange checks a change record's intent against the role and replaces
// its actor with the signed-in person.
func stampChange(w http.ResponseWriter, r *http.Request, u *User, role Role) bool {
	raw, ok := readBody(w, r, 64<<10)
	if !ok {
		return false
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(raw, &record); err != nil {
		jsonError(w, http.StatusBadRequest, "The request was not valid JSON.")
		return false
	}
	var intent string
	_ = json.Unmarshal(record["intent"], &intent)
	if !memberIntents[intent] && !role.canEdit() {
		jsonError(w, http.StatusForbidden, deniedEdit)
		return false
	}
	record["actor"] = stampedActor(record["actor"], u, role)
	stamped, _ := json.Marshal(record)
	replaceBody(r, stamped)
	return true
}

// anonymousActor is the frontend's Actor.ANONYMOUS, exactly.
var anonymousActor = Actor{ID: "anonymous", DisplayName: "this device"}

// stampedActor is who a change record is attributed to: the signed-in person
// — except for a record that claims nobody. Those were saved in a browser
// before anyone signed in, and are being uploaded now; "this device" is the
// truth about them, where the uploader's name would not be. Such a claim
// impersonates no one, and is rewritten to the canonical anonymous actor so
// it cannot carry a name with it.
func stampedActor(claimed json.RawMessage, u *User, role Role) json.RawMessage {
	var claim struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(claimed, &claim)
	who := actorFor(u, role)
	if claim.ID == anonymousActor.ID {
		who = anonymousActor
	}
	stamped, _ := json.Marshal(who)
	return stamped
}

// guardAnnotation protects PUT and DELETE /api/annotations/{id}.
//
// The existing markup is looked up BEFORE the request body is trusted: a PUT
// naming a markup on someone else's project, with a sheetId on your own,
// would otherwise move their markup into your project.
func guardAnnotation(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := signedIn(w, r)
		if !ok {
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/api/annotations/")
		if id == "" || strings.Contains(id, "/") {
			http.NotFound(w, r)
			return
		}

		var existingSheet string
		err := db.QueryRow(r.Context(), `SELECT sheet_id FROM annotations WHERE id = $1`, id).Scan(&existingSheet)
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			dbError(w, "find annotation", err)
			return
		}

		switch r.Method {
		case http.MethodDelete:
			if !exists {
				jsonError(w, http.StatusNotFound, "That markup no longer exists.")
				return
			}
			_, role, ok := sheetRole(w, r, u, existingSheet)
			if !ok {
				return
			}
			if !role.canEdit() {
				jsonError(w, http.StatusForbidden, deniedEdit)
				return
			}

		case http.MethodPut:
			// Ink strokes carry every sampled point, so markups are allowed
			// to be far larger than the account endpoints' 64 KB.
			raw, ok := readBody(w, r, 4<<20)
			if !ok {
				return
			}
			var in struct {
				SheetID string `json:"sheetId"`
				Kind    string `json:"kind"`
			}
			if err := json.Unmarshal(raw, &in); err != nil {
				jsonError(w, http.StatusBadRequest, "The request was not valid JSON.")
				return
			}
			if exists {
				if _, role, ok := sheetRole(w, r, u, existingSheet); !ok {
					return
				} else if !role.canEdit() {
					jsonError(w, http.StatusForbidden, deniedEdit)
					return
				}
				if in.SheetID != existingSheet {
					jsonError(w, http.StatusConflict, "A markup cannot be moved to a different sheet.")
					return
				}
			} else {
				_, role, ok := sheetRole(w, r, u, in.SheetID)
				if !ok {
					return
				}
				if !role.canCreate(in.Kind) {
					jsonError(w, http.StatusForbidden, deniedEdit)
					return
				}
			}
			replaceBody(r, raw)
		}

		next(w, r)
	}
}

// guardExports protects /api/exports.
//
// Recording an export: every sheet it lists must be in one project the person
// is on, and a flattened export — which locks markups for good — needs edit
// rights there. The "exported by" name is set from the session.
//
// Listing: handed to the handler with the caller, which shows only exports
// from the person's own projects.
func guardExports(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := signedIn(w, r)
		if !ok {
			return
		}
		if r.Method != http.MethodPost {
			next(w, withCaller(r, &Caller{User: u}))
			return
		}

		raw, ok := readBody(w, r, 4<<20)
		if !ok {
			return
		}
		var record map[string]json.RawMessage
		var in struct {
			Mode                 string              `json:"mode"`
			AnnotationIDsBySheet map[string][]string `json:"annotationIdsBySheet"`
		}
		if json.Unmarshal(raw, &record) != nil || json.Unmarshal(raw, &in) != nil {
			jsonError(w, http.StatusBadRequest, "The request was not valid JSON.")
			return
		}
		if len(in.AnnotationIDsBySheet) == 0 {
			jsonError(w, http.StatusBadRequest, "An export record must list the sheets it covers.")
			return
		}

		projectID := 0
		for sheetID := range in.AnnotationIDsBySheet {
			p, ok := sheetProject(sheetID)
			if !ok {
				jsonError(w, http.StatusForbidden, "This sheet is not part of a project. Open it from inside a project.")
				return
			}
			if projectID != 0 && p != projectID {
				jsonError(w, http.StatusBadRequest, "An export cannot cover sheets from more than one project.")
				return
			}
			projectID = p
		}
		role, ok := memberOf(w, r, u, projectID, false)
		if !ok {
			return
		}
		if in.Mode == "flattened" && !role.canEdit() {
			jsonError(w, http.StatusForbidden, "Your role on this project does not allow issuing a flattened PDF, which locks the markups in it.")
			return
		}

		exportedBy, _ := json.Marshal(actorFor(u, role).String())
		record["exportedBy"] = exportedBy
		stamped, _ := json.Marshal(record)
		replaceBody(r, stamped)

		next(w, withCaller(r, &Caller{User: u, ProjectID: projectID, Role: role}))
	}
}

// guardSealed protects GET /api/exports/sealed?document=&sheetId=.
func guardSealed(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := signedIn(w, r)
		if !ok {
			return
		}
		if sheetID := r.URL.Query().Get("sheetId"); sheetID != "" {
			if _, _, ok := sheetRole(w, r, u, sheetID); !ok {
				return
			}
		}
		next(w, r)
	}
}
