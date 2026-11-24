-- Photos attached to a punch item (SCRUM-88). Applied at startup; idempotent.
--
-- Separate from the item itself, so attaching a photo does not edit the item:
-- anyone on the project may attach one, a subcontractor photographing their
-- finished work included, while only editors may change the item. No foreign
-- key to annotations: an item can be deleted and restored (spec 8.2), and its
-- photos should come back with it.
CREATE TABLE IF NOT EXISTS item_photos (
  id            TEXT PRIMARY KEY,
  project_id    INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  annotation_id TEXT NOT NULL,
  media         JSONB NOT NULL,
  caption       TEXT NOT NULL DEFAULT '',
  added_by      JSONB NOT NULL,
  added_by_user INT REFERENCES users(id) ON DELETE SET NULL,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS item_photos_item_idx ON item_photos (annotation_id, added_at);
CREATE INDEX IF NOT EXISTS item_photos_project_idx ON item_photos (project_id);
