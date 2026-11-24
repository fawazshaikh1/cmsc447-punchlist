package main

// A drawing's revisions (SCRUM-90): an admin marks a newly uploaded drawing
// as the next revision of one already in the project, so the library knows
// which set is current and open items can carry forward (SCRUM-91).

import (
	"context"
	"fmt"
	"testing"
)

type revisionRow struct {
	DocumentID int    `json:"documentId"`
	RevisionOf int    `json:"revisionOf"`
	LinkedAt   string `json:"linkedAt"`
}

func storedDrawing(t *testing.T, project int, name string) int {
	t.Helper()
	var id int
	if err := db.QueryRow(context.Background(),
		`INSERT INTO documents (project_id, name, sha256, bytes, byte_size) VALUES ($1, $2, 'x', '\x00', 1) RETURNING id`,
		project, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func revisionPath(project, document, previous int) string {
	return projectPath(project, fmt.Sprintf("/documents/%d/revision-of/%d", document, previous))
}

func TestAnAdminMarksADrawingAsTheNextRevision(t *testing.T) {
	tm := newTeam(t)
	first := storedDrawing(t, tm.project, "Set.pdf")
	second := storedDrawing(t, tm.project, "Set (rev 2).pdf")
	third := storedDrawing(t, tm.project, "Set (rev 3).pdf")

	expect(t, tm.power.call("PUT", revisionPath(tm.project, second, first), nil), 403, "a power collaborator links a revision")
	expect(t, tm.collab.call("PUT", revisionPath(tm.project, second, first), nil), 403, "a collaborator links a revision")
	expect(t, tm.admin.call("PUT", revisionPath(tm.project, second, first), nil), 204, "the admin marks rev 2 as replacing the first set")
	expect(t, tm.admin.call("PUT", revisionPath(tm.project, second, first), nil), 204, "saying so again changes nothing")
	expect(t, tm.admin.call("PUT", revisionPath(tm.project, third, second), nil), 204, "and rev 3 as replacing rev 2")

	r := tm.collab.call("GET", projectPath(tm.project, "/revisions"), nil)
	expect(t, r, 200, "anyone on the project reads the revisions")
	var links []revisionRow
	r.json(&links)
	if len(links) != 2 || links[0].DocumentID != second || links[0].RevisionOf != first || links[1].DocumentID != third || links[1].RevisionOf != second || links[0].LinkedAt == "" {
		t.Fatalf("expected rev 2 then rev 3, each with what it replaces, got %+v", links)
	}
	expect(t, tm.outsider.call("GET", projectPath(tm.project, "/revisions"), nil), 403, "an outsider reads them")
}

func TestARevisionLinkMustMakeSense(t *testing.T) {
	tm := newTeam(t)
	first := storedDrawing(t, tm.project, "Set.pdf")
	second := storedDrawing(t, tm.project, "Set (rev 2).pdf")
	rival := storedDrawing(t, tm.project, "Set (other).pdf")
	elsewhere := storedDrawing(t, tm.outsider.newProject("Elsewhere"), "Theirs.pdf")

	expect(t, tm.admin.call("PUT", revisionPath(tm.project, first, first), nil), 400, "a drawing as its own revision")
	expect(t, tm.admin.call("PUT", revisionPath(tm.project, second, elsewhere), nil), 404, "a drawing from another project")
	expect(t, tm.admin.call("PUT", revisionPath(tm.project, second, first), nil), 204, "rev 2 replaces the first set")
	expect(t, tm.admin.call("PUT", revisionPath(tm.project, rival, first), nil), 409, "a second drawing replacing the same set")
	expect(t, tm.admin.call("PUT", revisionPath(tm.project, second, rival), nil), 409, "rev 2 replacing a different set as well")
	expect(t, tm.admin.call("PUT", revisionPath(tm.project, first, second), nil), 409, "the first set as a revision of its own revision")
}
