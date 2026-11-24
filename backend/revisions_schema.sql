-- A drawing's revisions (SCRUM-90). Applied at startup; idempotent.
--
-- One row per revision: this drawing replaces that one. Each drawing is
-- replaced at most once and is a revision of at most one, so a set's history
-- is a single line — rev 1, rev 2, rev 3 — and the current set is the one
-- nothing replaces.
CREATE TABLE IF NOT EXISTS document_revisions (
  document_id INT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  revision_of INT NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  linked_by   INT REFERENCES users(id) ON DELETE SET NULL,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
