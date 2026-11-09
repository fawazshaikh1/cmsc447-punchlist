package main

// Sheet names (spec 5.2): read from a drawing's title blocks, kept with the
// drawing on the server so every device shows the same A-101, and renamed by
// an admin when the reading was wrong.

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
)

// A name with spaces, a '%' and an '&' in it — "100% CD" is how a set at full
// construction documents is named — so the path escaping is exercised on
// every call. ('#' cannot appear: it marks the page in a sheet id, and the
// library refuses it.)
const namedDrawing = "A-101 100% CD set & stairs.pdf"

func sheetNamesPath(project int, name string) string {
	return fmt.Sprintf("/api/projects/%d/sheet-names/%s", project, url.PathEscape(name))
}

func sheetNamesListPath(project int) string {
	return fmt.Sprintf("/api/projects/%d/sheet-names", project)
}

func namesBody(source string, names ...SheetName) map[string]any {
	return map[string]any{"source": source, "names": names}
}

// listedNames reads the project's names and returns those of one drawing.
func listedNames(t *testing.T, b *browser, project int, drawing string) []SheetName {
	t.Helper()
	r := b.call("GET", sheetNamesListPath(project), nil)
	expect(t, r, 200, "the project's sheet names")
	var all map[string][]SheetName
	r.json(&all)
	return all[drawing]
}

func teamWithDrawing(t *testing.T) (team, Document) {
	t.Helper()
	tm := newTeam(t)
	r := tm.admin.addDrawing(tm.project, namedDrawing, pdfBytes("named"))
	expect(t, r, 201, "the admin adds the drawing")
	var d Document
	r.json(&d)
	return tm, d
}

func TestSheetNamesTravelWithTheDrawing(t *testing.T) {
	tm, _ := teamWithDrawing(t)

	r := tm.power.call("PUT", sheetNamesPath(tm.project, namedDrawing),
		namesBody("detected", SheetName{PageIndex: 0, Number: "A-101", Title: "LEVEL 1 FLOOR PLAN"}))
	expect(t, r, 200, "a power collaborator saves what the drawing says")

	got := listedNames(t, tm.collab, tm.project, namedDrawing)
	if len(got) != 1 || got[0].Number != "A-101" || got[0].Title != "LEVEL 1 FLOOR PLAN" || got[0].Source != "detected" {
		t.Fatalf("the collaborator sees %+v", got)
	}
}

func TestDetectionNeverOverwritesANameAndARenameAlwaysDoes(t *testing.T) {
	tm, _ := teamWithDrawing(t)
	path := sheetNamesPath(tm.project, namedDrawing)

	expect(t, tm.power.call("PUT", path, namesBody("detected", SheetName{PageIndex: 0, Number: "A-101"})), 200, "first reading")
	expect(t, tm.power.call("PUT", path, namesBody("detected", SheetName{PageIndex: 0, Number: "A-999"})), 200, "a second reading")
	if got := listedNames(t, tm.admin, tm.project, namedDrawing); got[0].Number != "A-101" {
		t.Fatalf("a second reading replaced the first: %+v", got)
	}

	expect(t, tm.admin.call("PUT", path, namesBody("edited", SheetName{PageIndex: 0, Number: "A-100", Title: "GROUND FLOOR"})), 200, "the admin renames")
	got := listedNames(t, tm.collab, tm.project, namedDrawing)
	if got[0].Number != "A-100" || got[0].Title != "GROUND FLOOR" || got[0].Source != "edited" {
		t.Fatalf("after the rename: %+v", got)
	}

	expect(t, tm.power.call("PUT", path, namesBody("detected", SheetName{PageIndex: 0, Number: "A-101"})), 200, "another device reads the drawing")
	if got := listedNames(t, tm.collab, tm.project, namedDrawing); got[0].Number != "A-100" {
		t.Fatalf("a reading undid the admin's rename: %+v", got)
	}
}

func TestWhoMaySaveSheetNames(t *testing.T) {
	tm, _ := teamWithDrawing(t)
	path := sheetNamesPath(tm.project, namedDrawing)
	name := SheetName{PageIndex: 0, Number: "A-101"}

	expect(t, tm.collab.call("PUT", path, namesBody("detected", name)), 403, "a collaborator saves a reading")
	r := tm.power.call("PUT", path, namesBody("edited", name))
	expect(t, r, 403, "a power collaborator renames")
	if !strings.Contains(r.errorText(), "Only a project admin can rename a sheet.") {
		t.Fatalf("refusal said %q", r.errorText())
	}
	expect(t, tm.outsider.call("GET", sheetNamesListPath(tm.project), nil), 403, "someone off the project reads")
	expect(t, tm.outsider.call("PUT", path, namesBody("detected", name)), 403, "someone off the project saves")
	expect(t, tm.admin.call("PUT", path, namesBody("edited", name)), 200, "the admin renames")
}

func TestSheetNamesForAnUnknownDrawingAre404(t *testing.T) {
	tm, _ := teamWithDrawing(t)
	r := tm.admin.call("PUT", sheetNamesPath(tm.project, "Z-999 Not here.pdf"),
		namesBody("edited", SheetName{PageIndex: 0, Number: "Z-999"}))
	expect(t, r, 404, "names for a drawing the project does not have")
	if !strings.Contains(r.errorText(), "No drawing called Z-999 Not here.pdf in this project.") {
		t.Fatalf("404 said %q", r.errorText())
	}
}

func TestSheetNamesAreChecked(t *testing.T) {
	tm, _ := teamWithDrawing(t)
	path := sheetNamesPath(tm.project, namedDrawing)

	expect(t, tm.admin.call("PUT", path, namesBody("guessed", SheetName{PageIndex: 0, Number: "A-101"})), 400, "an unknown source")
	expect(t, tm.admin.call("PUT", path, namesBody("edited", SheetName{PageIndex: -1, Number: "A-101"})), 400, "a negative page")
	expect(t, tm.admin.call("PUT", path, namesBody("edited", SheetName{PageIndex: 0, Number: strings.Repeat("A", 41)})), 400, "a 41-character number")
	expect(t, tm.admin.call("PUT", path, namesBody("edited", SheetName{PageIndex: 0, Title: strings.Repeat("T", 121)})), 400, "a 121-character title")
}

func TestRemovingADrawingRemovesItsNames(t *testing.T) {
	tm, d := teamWithDrawing(t)
	expect(t, tm.admin.call("PUT", sheetNamesPath(tm.project, namedDrawing),
		namesBody("detected", SheetName{PageIndex: 0, Number: "A-101"})), 200, "names saved")

	expect(t, tm.admin.call("DELETE", documentPath(tm.project, d.ID), nil), 204, "the admin removes the drawing")
	if got := listedNames(t, tm.admin, tm.project, namedDrawing); len(got) != 0 {
		t.Fatalf("names outlived their drawing: %+v", got)
	}
}
