-- Comments and replies (spec 7.1): a comment is a change record with intent
-- 'comment'; a reply names the comment it answers. Applied at startup;
-- idempotent.
ALTER TABLE change_history ADD COLUMN IF NOT EXISTS reply_to TEXT;
-- A task's history is read by id across sheets (tasks.go).
CREATE INDEX IF NOT EXISTS change_history_by_annotation_idx ON change_history (annotation_id, changed_at DESC);
