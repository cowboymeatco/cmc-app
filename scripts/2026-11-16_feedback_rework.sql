-- Rework joins the 💬 button's categories.
--
-- Charlie, 2026-11-11: "How do I track rework, double takes, mistakes,
-- defectives, things like that." 2026-11-16: a type on the feedback button,
-- not a log of its own (yet).
--
-- Same widening as 2026-08-27_feedback_incident_safety.sql: the check
-- constraint names every type, so the widget's new chip is rejected until
-- this runs.
--
-- NOT APPLIED. Waiting on Charlie's go-ahead.

alter table feedback drop constraint if exists feedback_type_check;

alter table feedback add constraint feedback_type_check
  check (type = any (array['bug', 'idea', 'incident', 'safety', 'rework']));
