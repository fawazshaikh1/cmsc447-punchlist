-- Reversing the workflow (spec 8). Applied at startup; idempotent.

-- Recently deleted (8.2): a copy of every markup as it was when it was
-- deleted, kept by a trigger so that no delete path — one markup, a bulk
-- delete, clearing a sheet — can skip it. One copy per markup: deleting it
-- again replaces the copy. Saving the markup again (restore, undo, a task
-- placed on a sheet) removes the copy, so nothing is left behind.
CREATE TABLE IF NOT EXISTS annotation_trash (
  id         TEXT PRIMARY KEY,
  sheet_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  x          DOUBLE PRECISION,
  y          DOUBLE PRECISION,
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS annotation_trash_sheet_idx ON annotation_trash (sheet_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS annotation_trash_age_idx ON annotation_trash (deleted_at);

CREATE OR REPLACE FUNCTION keep_deleted_annotation() RETURNS trigger AS $$
BEGIN
  INSERT INTO annotation_trash (id, sheet_id, kind, x, y, payload, created_at, deleted_at)
  VALUES (OLD.id, OLD.sheet_id, OLD.kind, OLD.x, OLD.y, OLD.payload, OLD.created_at, clock_timestamp())
  ON CONFLICT (id) DO UPDATE
  SET sheet_id = EXCLUDED.sheet_id, kind = EXCLUDED.kind, x = EXCLUDED.x, y = EXCLUDED.y,
      payload = EXCLUDED.payload, created_at = EXCLUDED.created_at, deleted_at = EXCLUDED.deleted_at;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION forget_restored_annotation() RETURNS trigger AS $$
BEGIN
  DELETE FROM annotation_trash WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER annotations_keep_deleted
  BEFORE DELETE ON annotations FOR EACH ROW EXECUTE FUNCTION keep_deleted_annotation();
CREATE OR REPLACE TRIGGER annotations_forget_restored
  AFTER INSERT ON annotations FOR EACH ROW EXECUTE FUNCTION forget_restored_annotation();

-- Un-issue (8.3): a void lifts an issue's locks. The issue stays in
-- export_history — it was sent, and the log keeps saying so.
CREATE TABLE IF NOT EXISTS export_voids (
  export_id      TEXT PRIMARY KEY REFERENCES export_history(id) ON DELETE CASCADE,
  voided_by      TEXT NOT NULL,
  voided_by_user INT REFERENCES users(id) ON DELETE SET NULL,
  voided_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reason         TEXT NOT NULL
);
