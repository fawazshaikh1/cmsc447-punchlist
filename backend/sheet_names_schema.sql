-- Sheet names (spec 5.2): what each page of a drawing is called — "A-101",
-- "LEVEL 1 FLOOR PLAN" — so every device shows the same name without
-- reading the drawing again. Applied by the server at startup; idempotent.
--
-- 'detected' names were read from the title block by an editor's browser and
-- only ever fill pages without a name; 'edited' names were typed by an admin
-- and replace whatever was there. A drawing removed from the project takes its
-- names with it.
CREATE TABLE IF NOT EXISTS sheet_names (
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index  INT NOT NULL CHECK (page_index >= 0),
  number      TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL CHECK (source IN ('detected', 'edited')),
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, page_index)
);
