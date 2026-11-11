-- Sheet bookmarks (spec 7.2): each person's own starred sheets, on every
-- device. Applied at startup; idempotent.
CREATE TABLE IF NOT EXISTS sheet_bookmarks (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, sheet_id)
);
