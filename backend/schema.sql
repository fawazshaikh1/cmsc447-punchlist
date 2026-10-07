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

CREATE TABLE comments (
  id            SERIAL PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  author_id     INT NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE change_history (
  id            SERIAL PRIMARY KEY,
  annotation_id TEXT,
  user_id       INT REFERENCES users(id),
  action        TEXT NOT NULL,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE export_history (
  id          SERIAL PRIMARY KEY,
  sheet_id    TEXT,
  exported_by INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);