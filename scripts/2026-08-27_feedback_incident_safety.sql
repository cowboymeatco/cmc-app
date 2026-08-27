-- Customer incident and safety join the 💬 button's categories.
--
-- Charlie, 2026-08-27: "Maybe make a spot for a customer incident reporting and
-- then also a safety category?"
--
-- feedback.type was pinned to bug|idea by a check constraint, so the widget
-- could offer the categories all it liked and the insert would still be
-- rejected. Widening the constraint rather than dropping it: the column is what
-- the triage page filters and colours on, and a typo'd type would render as a
-- neutral note and quietly sit in nobody's tab.
--
-- APPLIED 2026-08-27. Do not re-run.

alter table feedback drop constraint if exists feedback_type_check;

alter table feedback add constraint feedback_type_check
  check (type = any (array['bug', 'idea', 'incident', 'safety']));
