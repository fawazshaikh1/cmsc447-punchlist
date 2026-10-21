-- Photographs (SCRUM-45). Applied by the server at startup, like
-- auth_schema.sql; every statement is idempotent.
--
-- The bytes live in Postgres for now. Photos are downscaled to 1600px JPEGs
-- before they are sent (a few hundred KB each), so a project's worth is well
-- within what a database holds comfortably. Moving them to S3 when the app is
-- deployed (SCRUM-49) changes media.go's storage calls and nothing else: the
-- browser only ever sees /api/media/{key}.
--
-- Separate from the `photos` table in schema.sql, which links a photo to an
-- annotation: a photo is stored BEFORE its markup exists (the capture comes
-- first), so a foreign key to annotations could never be satisfied here.
CREATE TABLE IF NOT EXISTS media (
  key         TEXT PRIMARY KEY,
  project_id  INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mime_type   TEXT NOT NULL,
  bytes       BYTEA NOT NULL,
  byte_size   INT NOT NULL,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_project_idx ON media (project_id);
