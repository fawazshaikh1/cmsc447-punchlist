CREATE TYPE member_role AS ENUM ('admin', 'power_collaborator', 'collaborator');

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  display_name  TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  company       TEXT,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  project_id INT REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  role       member_role NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE sheets (
  id         TEXT PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  s3_key     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE annotations (
  id          TEXT PRIMARY KEY,
  sheet_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  x           DOUBLE PRECISION,
  y           DOUBLE PRECISION,
  payload     JSONB NOT NULL DEFAULT '{}',
  trade       TEXT,
  company     TEXT,
  assignee_id INT REFERENCES users(id),
  due_date    DATE,
  status      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE photos (
  id            SERIAL PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  s3_key        TEXT NOT NULL,
  uploaded_by   INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only record of who changed what. Mirrors the frontend ChangeRecord.
-- actor is a JSON snapshot (name, company, role at the time), NOT a user id.
-- Comments are stored here too, with intent = 'comment' (no separate table).
CREATE TABLE change_history (
  id            TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL,
  sheet_id      TEXT NOT NULL,
  intent        TEXT NOT NULL,
  actor         JSONB NOT NULL,
  changed_at    TIMESTAMPTZ NOT NULL,
  detail        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX change_history_annotation_idx ON change_history (sheet_id, annotation_id, changed_at DESC);
CREATE INDEX change_history_sheet_idx ON change_history (sheet_id, changed_at DESC);

-- Append-only record of exports. Mirrors the frontend ExportRecord.
-- A flattened export "seals" every annotation id it lists.
CREATE TABLE export_history (
  id                      TEXT PRIMARY KEY,
  document_name           TEXT NOT NULL,
  mode                    TEXT NOT NULL CHECK (mode IN ('flattened', 'native')),
  exported_at             TIMESTAMPTZ NOT NULL,
  exported_by             TEXT NOT NULL,
  annotation_ids_by_sheet JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX export_history_document_idx ON export_history (document_name, exported_at DESC);