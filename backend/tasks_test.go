package main

// The Tasks tab (spec 6): what it reads beyond the punch list's items — the
// markups an issue has locked anywhere in the project, who last changed each
// task, and a task's history on every sheet it has been on.

import (
	"fmt"
	"testing"
)

// uid makes ids unique to one test's project: the tables are shared by every
// test in a run, and a repeated change id is silently ignored by design.
func uid(tm team, name string) string { return fmt.Sprintf("p%d-%s", tm.project, name) }

func tasksSheet(project int) string { return fmt.Sprintf("p%d:~tasks#0", project) }

func projectPath(project int, rest string) string {
	return fmt.Sprintf("/api/projects/%d%s", project, rest)
}

func changeRecord(id, annotationID, sheetID, intent, at string) map[string]any {
	return map[string]any{
		"id": id, "annotationId": annotationID, "sheetId": sheetID, "intent": intent,
		"at": at, "actor": map[string]string{},
	}
}

func flattenedExport(id string, bySheet map[string][]string) map[string]any {
	return map[string]any{
		"id": id, "documentName": "A-101.pdf", "mode": "flattened",
		"exportedAt": "2026-11-01T12:00:00.000Z", "exportedBy": "Somebody",
		"annotationIdsBySheet": bySheet,
	}
}

func TestTheTasksTabSeesEveryIssuedMarkupInItsProject(t *testing.T) {
	tm := newTeam(t)
	issued, open := uid(tm, "issued"), uid(tm, "open")
	for _, id := range []string{issued, open} {
		expect(t, tm.admin.call("PUT", annotationPath(id), markup(id, tm.sheet, "pin")), 204, "the admin adds "+id)
	}
	expect(t, tm.admin.call("POST", "/api/exports", flattenedExport(uid(tm, "e1"), map[string][]string{tm.sheet: {issued}})), 204, "the admin issues the drawing")

	// Another project's issue must not leak into this one's locks.
	other := tm.outsider.newProject("Elsewhere")
	elsewhere := sheet(other, "B.pdf")
	theirs := uid(tm, "theirs")
	expect(t, tm.outsider.call("PUT", annotationPath(theirs), markup(theirs, elsewhere, "pin")), 204, "the outsider adds to their own project")
	expect(t, tm.outsider.call("POST", "/api/exports", flattenedExport(uid(tm, "e2"), map[string][]string{elsewhere: {theirs}})), 204, "and issues it")

	r := tm.collab.call("GET", projectPath(tm.project, "/sealed"), nil)
	expect(t, r, 200, "a collaborator reads the project's locks")
	var ids []string
	r.json(&ids)
	if len(ids) != 1 || ids[0] != issued {
		t.Fatalf("expected only %q locked, got %v", issued, ids)
	}
	expect(t, tm.outsider.call("GET", projectPath(tm.project, "/sealed"), nil), 403, "an outsider reads the project's locks")
}

func TestTheTasksTabSeesWhoLastChangedEachTask(t *testing.T) {
	tm := newTeam(t)
	pinned, offSheet := uid(tm, "pinned"), uid(tm, "off-sheet")
	post := func(b *browser, sheetID, id, annotationID, at string) {
		t.Helper()
		expect(t, b.call("POST", sheetPath(sheetID, "/changes"), changeRecord(id, annotationID, sheetID, "update", at)), 204, "record "+id)
	}
	post(tm.admin, tm.sheet, uid(tm, "c1"), pinned, "2026-11-01T10:00:00.000Z")
	post(tm.power, tm.sheet, uid(tm, "c2"), pinned, "2026-11-02T10:00:00.000Z")
	post(tm.admin, tasksSheet(tm.project), uid(tm, "c3"), offSheet, "2026-11-03T10:00:00.000Z")

	r := tm.collab.call("GET", projectPath(tm.project, "/changes/latest"), nil)
	expect(t, r, 200, "a collaborator reads the latest changes")
	var latest map[string]ChangeRecord
	r.json(&latest)
	if len(latest) != 2 || latest[pinned].ID != uid(tm, "c2") || latest[offSheet].ID != uid(tm, "c3") {
		t.Fatalf("expected the newest change to each task, got %+v", latest)
	}
	expect(t, tm.outsider.call("GET", projectPath(tm.project, "/changes/latest"), nil), 403, "an outsider reads them")
}

func TestATaskKeepsItsHistoryWhenItIsPlacedOnASheet(t *testing.T) {
	tm := newTeam(t)
	id, tasks := uid(tm, "task"), tasksSheet(tm.project)

	expect(t, tm.admin.call("PUT", annotationPath(id), markup(id, tasks, "task")), 204, "the admin adds a task off the drawings")
	expect(t, tm.admin.call("POST", sheetPath(tasks, "/changes"), changeRecord(uid(tm, "c1"), id, tasks, "create", "2026-11-01T10:00:00.000Z")), 204, "its creation is recorded")
	expect(t, tm.collab.call("PUT", annotationPath(uid(tm, "collab-task")), markup(uid(tm, "collab-task"), tasks, "task")), 403, "a collaborator adds a task")

	// Placed on a sheet: removed from the tasks sheet, made again on the drawing.
	expect(t, tm.admin.call("DELETE", annotationPath(id), nil), 204, "the task leaves the tasks sheet")
	expect(t, tm.admin.call("PUT", annotationPath(id), markup(id, tm.sheet, "pin")), 204, "and is made again on the drawing")
	expect(t, tm.admin.call("POST", sheetPath(tm.sheet, "/changes"), changeRecord(uid(tm, "c2"), id, tm.sheet, "create", "2026-11-02T10:00:00.000Z")), 204, "the placing is recorded")

	r := tm.collab.call("GET", annotationPath(id)+"/changes", nil)
	expect(t, r, 200, "a collaborator reads the task's history")
	var history []ChangeRecord
	r.json(&history)
	if len(history) != 2 || history[0].SheetID != tm.sheet || history[1].SheetID != tasks {
		t.Fatalf("expected both sheets' history, newest first, got %+v", history)
	}
	expect(t, tm.outsider.call("GET", annotationPath(id)+"/changes", nil), 403, "an outsider reads it")
	expect(t, tm.admin.call("GET", annotationPath(uid(tm, "never"))+"/changes", nil), 404, "an item with no history")
}
