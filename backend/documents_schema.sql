-- Drawings on the server: each project's library of PDF drawing sets (FR-10).
-- Applied at startup after media_schema.sql; safe to run again.

CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  project_id  INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The drawing's file name. Sheets are named after it (p{project}:{name}#{page}),
  -- so it is what ties the stored file to the markups already made on it.
  name        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  bytes       BYTEA NOT NULL,
  byte_size   INT NOT NULL,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
