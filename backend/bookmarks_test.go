package main

// Sheet bookmarks (spec 7.2): each person's own starred sheets, on every
// device, inside one project.

import (
	"net/url"
	"testing"
)

func bookmarkPath(project int, sheetID string) string {
	return projectPath(project, "/bookmarks/"+url.PathEscape(sheetID))
}

func bookmarksOf(t *testing.T, b *browser, project int) []Bookmark {
	t.Helper()
	r := b.call("GET", projectPath(project, "/bookmarks"), nil)
	expect(t, r, 200, "the bookmarks")
	var list []Bookmark
	r.json(&list)
	return list
}

func TestBookmarksArePersonal(t *testing.T) {
	tm := newTeam(t)
	second := sheet(tm.project, "A-102.pdf")

	expect(t, tm.collab.call("PUT", bookmarkPath(tm.project, tm.sheet), nil), 204, "a collaborator stars a sheet")
	expect(t, tm.collab.call("PUT", bookmarkPath(tm.project, tm.sheet), nil), 204, "starring it again changes nothing")
	expect(t, tm.collab.call("PUT", bookmarkPath(tm.project, second), nil), 204, "and stars another")
	expect(t, tm.power.call("PUT", bookmarkPath(tm.project, second), nil), 204, "the power collaborator stars one of their own")

	if got := bookmarksOf(t, tm.collab, tm.project); len(got) != 2 || got[0].SheetID != tm.sheet || got[1].SheetID != second {
		t.Fatalf("the collaborator's bookmarks, in the order made: got %+v", got)
	}
	if got := bookmarksOf(t, tm.power, tm.project); len(got) != 1 || got[0].SheetID != second {
		t.Fatalf("the power collaborator sees only their own: got %+v", got)
	}

	expect(t, tm.collab.call("DELETE", bookmarkPath(tm.project, tm.sheet), nil), 204, "unstar")
	expect(t, tm.collab.call("DELETE", bookmarkPath(tm.project, tm.sheet), nil), 204, "unstar again")
	if got := bookmarksOf(t, tm.collab, tm.project); len(got) != 1 || got[0].SheetID != second {
		t.Fatalf("one bookmark left: got %+v", got)
	}
}

func TestBookmarksStayInsideTheirProject(t *testing.T) {
	tm := newTeam(t)
	expect(t, tm.outsider.call("PUT", bookmarkPath(tm.project, tm.sheet), nil), 403, "an outsider stars a sheet")
	expect(t, tm.outsider.call("GET", projectPath(tm.project, "/bookmarks"), nil), 403, "an outsider reads the bookmarks")

	other := tm.admin.newProject("Other")
	expect(t, tm.admin.call("PUT", bookmarkPath(tm.project, sheet(other, "B.pdf")), nil), 400, "a sheet from another project")
	expect(t, tm.admin.call("PUT", bookmarkPath(tm.project, "B.pdf#0"), nil), 400, "a sheet outside any project")
}
