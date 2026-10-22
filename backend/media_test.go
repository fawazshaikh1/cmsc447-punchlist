package main

// Photos on the server (SCRUM-45). Same throwaway database and real routes as
// auth_test.go.

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// putPhoto uploads raw bytes the way HttpMediaStore does.
func (b *browser) putPhoto(key string, project int, contentType string, body []byte) reply {
	b.t.Helper()
	req, _ := http.NewRequest("PUT", fmt.Sprintf("%s/api/media/%s?project=%d", server.URL, key, project), bytes.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Punchlist-Request", "1")
	res, err := b.client.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return reply{status: res.StatusCode, body: raw, header: res.Header}
}

var jpeg = append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte("site photo "), 50)...)

func TestPhotosTravelWithTheProject(t *testing.T) {
	tm := newTeam(t)
	key := fmt.Sprintf("photo_%d", emailCounter.Add(1))

	expect(t, tm.collab.putPhoto(key, tm.project, "image/jpeg", jpeg), 204, "a collaborator adds a photo")
	expect(t, tm.collab.putPhoto(key, tm.project, "image/jpeg", jpeg), 204, "a retry of the same upload")

	for _, who := range []*browser{tm.admin, tm.power, tm.collab} {
		r := who.call("GET", "/api/media/"+key, nil)
		expect(t, r, 200, "read by "+who.user.DisplayName)
		if !bytes.Equal(r.body, jpeg) || r.header.Get("Content-Type") != "image/jpeg" {
			t.Fatalf("got %d bytes as %q", len(r.body), r.header.Get("Content-Type"))
		}
		if !strings.Contains(r.header.Get("Cache-Control"), "private") || r.header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("headers: %v", r.header)
		}
	}
	expect(t, tm.outsider.call("GET", "/api/media/"+key, nil), 403, "an outsider reads it")
	expect(t, newBrowser(t).call("GET", "/api/media/"+key, nil), 401, "nobody signed in reads it")
	expect(t, tm.admin.call("GET", "/api/media/photo_never_uploaded", nil), 404, "an unknown key")
}

func TestOnlyImagesOfASensibleSizeAreAccepted(t *testing.T) {
	tm := newTeam(t)
	key := func() string { return fmt.Sprintf("photo_%d", emailCounter.Add(1)) }

	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	expect(t, tm.admin.putPhoto(key(), tm.project, "image/svg+xml", svg), 415, "an SVG, which can carry script")
	expect(t, tm.admin.putPhoto(key(), tm.project, "text/html", []byte("<h1>hi</h1>")), 415, "HTML posing as a photo")
	expect(t, tm.admin.putPhoto(key(), tm.project, "image/jpeg", nil), 400, "an empty photo")
	expect(t, tm.admin.putPhoto(key(), tm.project, "image/jpeg", make([]byte, maxMediaBytes+1)), 413, "too large")
	expect(t, tm.admin.putPhoto("../../etc/passwd", tm.project, "image/jpeg", jpeg), 404, "a key that is a path")
	expect(t, tm.outsider.putPhoto(key(), tm.project, "image/jpeg", jpeg), 403, "an outsider adds a photo")

	r := tm.admin.send("PUT", fmt.Sprintf("/api/media/%s?project=%d", key(), tm.project), nil, nil)
	expect(t, r, 403, "an upload without the app header")
}

func TestAPhotoKeyBelongsToOneProject(t *testing.T) {
	tm := newTeam(t)
	other := tm.admin.newProject("Other")
	key := fmt.Sprintf("photo_%d", emailCounter.Add(1))

	expect(t, tm.admin.putPhoto(key, tm.project, "image/jpeg", jpeg), 204, "first upload")
	expect(t, tm.admin.putPhoto(key, other, "image/jpeg", jpeg), 409, "the same key into another project")
}

func TestOnlyEditorsDeletePhotos(t *testing.T) {
	tm := newTeam(t)
	key := fmt.Sprintf("photo_%d", emailCounter.Add(1))
	expect(t, tm.collab.putPhoto(key, tm.project, "image/jpeg", jpeg), 204, "upload")

	expect(t, tm.collab.call("DELETE", "/api/media/"+key, nil), 403, "a collaborator deletes, even their own")
	expect(t, tm.outsider.call("DELETE", "/api/media/"+key, nil), 403, "an outsider deletes")
	expect(t, tm.power.call("DELETE", "/api/media/"+key, nil), 204, "a power collaborator deletes")
	expect(t, tm.admin.call("GET", "/api/media/"+key, nil), 404, "gone")
	expect(t, tm.admin.call("DELETE", "/api/media/"+key, nil), 204, "deleting it again is fine")
}
