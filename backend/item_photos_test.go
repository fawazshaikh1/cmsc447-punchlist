package main

// Photos attached to a punch item (SCRUM-88): anyone on the project may add
// one — a subcontractor photographing finished work is the usual case — and
// only from this project's own photos.

import (
	"context"
	"testing"
)

type itemPhotoRow struct {
	ID           string `json:"id"`
	AnnotationID string `json:"annotationId"`
	Media        struct {
		Key      string `json:"key"`
		MimeType string `json:"mimeType"`
		Width    int    `json:"width"`
	} `json:"media"`
	Caption string `json:"caption"`
	AddedBy struct {
		DisplayName string `json:"displayName"`
	} `json:"addedBy"`
	AddedAt string `json:"addedAt"`
}

func storedMedia(t *testing.T, key string, project int) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO media (key, project_id, mime_type, bytes, byte_size) VALUES ($1, $2, 'image/jpeg', '\x00', 1)`,
		key, project); err != nil {
		t.Fatal(err)
	}
}

func photoOf(id, key, caption string) map[string]any {
	return map[string]any{
		"id":      id,
		"media":   map[string]any{"key": key, "mimeType": "image/jpeg", "width": 1600, "height": 1200, "byteSize": 1},
		"caption": caption,
	}
}

func TestAnyoneOnTheProjectAttachesPhotosToAnItem(t *testing.T) {
	tm := newTeam(t)
	item := uid(tm, "item")
	expect(t, tm.admin.call("PUT", annotationPath(item), markup(item, tm.sheet, "pin")), 204, "the admin adds a pin")
	first, second := uid(tm, "m1"), uid(tm, "m2")
	storedMedia(t, first, tm.project)
	storedMedia(t, second, tm.project)

	expect(t, tm.collab.call("POST", annotationPath(item)+"/photos", photoOf(uid(tm, "p1"), first, "  Closer fitted  ")), 201, "a collaborator attaches a photo")
	expect(t, tm.power.call("POST", annotationPath(item)+"/photos", photoOf(uid(tm, "p2"), second, "")), 201, "a power collaborator attaches another")
	expect(t, tm.collab.call("POST", annotationPath(item)+"/photos", photoOf(uid(tm, "p1"), first, "again")), 200, "sending the same photo again changes nothing")
	expect(t, tm.outsider.call("POST", annotationPath(item)+"/photos", photoOf(uid(tm, "p3"), first, "")), 403, "an outsider attaches one")

	r := tm.collab.call("GET", annotationPath(item)+"/photos", nil)
	expect(t, r, 200, "the item's photos")
	var photos []itemPhotoRow
	r.json(&photos)
	if len(photos) != 2 || photos[0].Media.Key != first || photos[0].Caption != "Closer fitted" || photos[1].Media.Key != second {
		t.Fatalf("expected both photos, oldest first, caption trimmed, got %+v", photos)
	}
	if photos[0].AddedBy.DisplayName != "TeamCollab" || photos[0].AnnotationID != item || photos[0].Media.Width != 1600 || photos[0].AddedAt == "" {
		t.Fatalf("expected who added it, which item, the photo's size and when, got %+v", photos[0])
	}

	r = tm.collab.call("GET", projectPath(tm.project, "/item-photos"), nil)
	expect(t, r, 200, "the project's item photos")
	var byItem map[string][]itemPhotoRow
	r.json(&byItem)
	if len(byItem) != 1 || len(byItem[item]) != 2 {
		t.Fatalf("expected one item with two photos, got %v", byItem)
	}
	expect(t, tm.outsider.call("GET", projectPath(tm.project, "/item-photos"), nil), 403, "an outsider reads them")
	expect(t, tm.outsider.call("GET", annotationPath(item)+"/photos", nil), 403, "an outsider reads one item's")
}

func TestAPhotoMustBeThisProjectsAndTheItemMustExist(t *testing.T) {
	tm := newTeam(t)
	item := uid(tm, "item")
	expect(t, tm.admin.call("PUT", annotationPath(item), markup(item, tm.sheet, "pin")), 204, "the admin adds a pin")

	other := tm.outsider.newProject("Elsewhere")
	theirs := uid(tm, "theirs")
	storedMedia(t, theirs, other)
	ours := uid(tm, "ours")
	storedMedia(t, ours, tm.project)

	expect(t, tm.admin.call("POST", annotationPath(item)+"/photos", photoOf(uid(tm, "x"), theirs, "")), 400, "another project's photo")
	expect(t, tm.admin.call("POST", annotationPath(item)+"/photos", photoOf(uid(tm, "y"), uid(tm, "nothing"), "")), 400, "a photo that was never uploaded")
	expect(t, tm.admin.call("POST", annotationPath(uid(tm, "ghost"))+"/photos", photoOf(uid(tm, "z"), ours, "")), 404, "an item that does not exist")
	long := make([]byte, 201)
	for i := range long {
		long[i] = 'x'
	}
	expect(t, tm.admin.call("POST", annotationPath(item)+"/photos", photoOf(uid(tm, "w"), ours, string(long))), 400, "a caption over 200 characters")
	expect(t, tm.admin.call("POST", annotationPath(item)+"/photos", photoOf("", ours, "")), 400, "a photo with no id")
}

func TestAPhotoIsRemovedByWhoeverAddedItOrAnEditor(t *testing.T) {
	tm := newTeam(t)
	item := uid(tm, "item")
	expect(t, tm.admin.call("PUT", annotationPath(item), markup(item, tm.sheet, "pin")), 204, "the admin adds a pin")
	key := uid(tm, "m")
	storedMedia(t, key, tm.project)

	mine, theirs := uid(tm, "mine"), uid(tm, "theirs")
	expect(t, tm.collab.call("POST", annotationPath(item)+"/photos", photoOf(mine, key, "")), 201, "the collaborator adds one")
	expect(t, tm.admin.call("POST", annotationPath(item)+"/photos", photoOf(theirs, key, "")), 201, "the admin adds one")

	expect(t, tm.collab.call("DELETE", "/api/item-photos/"+theirs, nil), 403, "a collaborator removes someone else's")
	expect(t, tm.outsider.call("DELETE", "/api/item-photos/"+mine, nil), 403, "an outsider removes one")
	expect(t, tm.collab.call("DELETE", "/api/item-photos/"+mine, nil), 204, "the collaborator removes their own")
	expect(t, tm.power.call("DELETE", "/api/item-photos/"+theirs, nil), 204, "a power collaborator removes the admin's")
	expect(t, tm.power.call("DELETE", "/api/item-photos/"+theirs, nil), 404, "removing it twice")
}
