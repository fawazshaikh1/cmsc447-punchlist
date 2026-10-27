package main

// Drawings on the server (FR-10). Same throwaway database and real routes as
// auth_test.go.

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"testing"
)

// addDrawing uploads raw bytes the way HttpDrawingLibrary does.
func (b *browser) addDrawing(project int, name string, body []byte) reply {
	b.t.Helper()
	req, _ := http.NewRequest("POST",
		fmt.Sprintf("%s/api/projects/%d/documents?name=%s", server.URL, project, url.QueryEscape(name)),
		bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/pdf")
	req.Header.Set("X-Punchlist-Request", "1")
	res, err := b.client.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return reply{status: res.StatusCode, body: raw, header: res.Header}
}

func pdfBytes(label string) []byte {
	return []byte("%PDF-1.7\n% " + label + "\n" + string(bytes.Repeat([]byte("0"), 200)) + "\n%%EOF\n")
}

func documentPath(project, id int) string {
	return fmt.Sprintf("/api/projects/%d/documents/%d", project, id)
}

func TestDrawingsTravelWithTheProject(t *testing.T) {
	tm := newTeam(t)
	drawing := pdfBytes("A-101")

	r := tm.admin.addDrawing(tm.project, "A-101 Ground floor.pdf", drawing)
	expect(t, r, 201, "the admin adds a drawing")
	var added Document
	r.json(&added)
	if added.Name != "A-101 Ground floor.pdf" || added.ByteSize != len(drawing) || added.UploadedBy != tm.admin.user.DisplayName {
		t.Fatalf("added: %+v", added)
	}

	r = tm.admin.addDrawing(tm.project, "A-101 Ground floor.pdf", drawing)
	expect(t, r, 200, "the same file again, from another device")
	var again Document
	r.json(&again)
	if again.ID != added.ID {
		t.Fatalf("the same file made a second drawing: %d then %d", added.ID, again.ID)
	}

	for _, who := range []*browser{tm.admin, tm.power, tm.collab} {
		var list []Document
		r := who.call("GET", fmt.Sprintf("/api/projects/%d/documents", tm.project), nil)
		expect(t, r, 200, "the library, as "+who.user.DisplayName)
		r.json(&list)
		if len(list) != 1 || list[0].ID != added.ID {
			t.Fatalf("library for %s: %+v", who.user.DisplayName, list)
		}

		r = who.call("GET", documentPath(tm.project, added.ID), nil)
		expect(t, r, 200, "open the drawing, as "+who.user.DisplayName)
		if !bytes.Equal(r.body, drawing) || r.header.Get("Content-Type") != "application/pdf" {
			t.Fatalf("got %d bytes as %q", len(r.body), r.header.Get("Content-Type"))
		}
	}

	expect(t, tm.outsider.call("GET", fmt.Sprintf("/api/projects/%d/documents", tm.project), nil), 403, "an outsider lists")
	expect(t, tm.outsider.call("GET", documentPath(tm.project, added.ID), nil), 403, "an outsider opens")
	expect(t, newBrowser(t).call("GET", documentPath(tm.project, added.ID), nil), 401, "nobody signed in opens")
}

func TestOnlyAdminsAddOrRemoveDrawings(t *testing.T) {
	tm := newTeam(t)

	expect(t, tm.power.addDrawing(tm.project, "S-201.pdf", pdfBytes("S")), 403, "a power collaborator adds")
	expect(t, tm.collab.addDrawing(tm.project, "S-201.pdf", pdfBytes("S")), 403, "a collaborator adds")

	r := tm.admin.addDrawing(tm.project, "S-201.pdf", pdfBytes("S"))
	expect(t, r, 201, "the admin adds")
	var d Document
	r.json(&d)

	expect(t, tm.power.call("DELETE", documentPath(tm.project, d.ID), nil), 403, "a power collaborator deletes")
	expect(t, tm.collab.call("DELETE", documentPath(tm.project, d.ID), nil), 403, "a collaborator deletes")
	expect(t, tm.admin.call("DELETE", documentPath(tm.project, d.ID), nil), 204, "the admin deletes")
	expect(t, tm.admin.call("GET", documentPath(tm.project, d.ID), nil), 404, "it is gone")
}

func TestDrawingUploadsAreChecked(t *testing.T) {
	tm := newTeam(t)

	expect(t, tm.admin.addDrawing(tm.project, "plan.pdf", []byte("<html>not a drawing</html>")), 415, "not a PDF")
	expect(t, tm.admin.addDrawing(tm.project, "plan.pdf", nil), 400, "an empty file")
	expect(t, tm.admin.addDrawing(tm.project, "../plan.pdf", pdfBytes("x")), 400, "a name that is a path")
	expect(t, tm.admin.addDrawing(tm.project, "   ", pdfBytes("x")), 400, "no name")

	expect(t, tm.admin.addDrawing(tm.project, "M-301.pdf", pdfBytes("first")), 201, "first file")
	expect(t, tm.admin.addDrawing(tm.project, "M-301.pdf", pdfBytes("different")), 409, "another file under the same name")

	r := tm.admin.send("POST", fmt.Sprintf("/api/projects/%d/documents?name=x.pdf", tm.project), nil, nil)
	expect(t, r, 403, "an upload without the app header")
}

func TestADrawingIsReachableOnlyThroughItsProject(t *testing.T) {
	tm := newTeam(t)
	other := tm.admin.newProject("Other job")

	r := tm.admin.addDrawing(other, "E-401.pdf", pdfBytes("E"))
	expect(t, r, 201, "a drawing on the other project")
	var d Document
	r.json(&d)

	expect(t, tm.admin.call("GET", documentPath(tm.project, d.ID), nil), 404, "through the wrong project")
	expect(t, tm.power.call("GET", documentPath(other, d.ID), nil), 403, "by someone not on its project")
	expect(t, tm.admin.call("DELETE", documentPath(tm.project, d.ID), nil), 404, "deleted through the wrong project")
	expect(t, tm.admin.call("GET", documentPath(other, d.ID), nil), 200, "still there")
}
