-- Accounts, sign-in sessions and project-scoped exports (SCRUM-42, 43, 46).
--
-- Applied by the server itself at startup (see migrate in auth.go), so a
-- database created from schema.sql before sign-in existed is brought up to
-- date without anyone running psql. Every statement is idempotent: running it
-- on every start is safe.
--
-- users, projects and memberships already exist in schema.sql. This adds only
-- what sign-in needs on top of them.

-- Registration asks for a job title alongside name and company, as the
-- stakeholder described. Empty for any row created before this existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

-- One row per signed-in browser. Only a SHA-256 digest of the cookie value is
-- stored, so a leaked database cannot be replayed as live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- "Which projects am I on?" is asked on every request.
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

-- Which project an export belongs to, so the history is only shown to its
-- members. NULL for exports recorded before projects existed: no project's
-- members can see them, which is the safe reading of "nobody knows whose".
ALTER TABLE export_history ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE CASCADE;
