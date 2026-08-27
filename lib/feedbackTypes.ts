// What the 💬 button can file, in one place.
//
// The widget, the /feedback triage page and the notify-feedback email all have
// to agree on what a type is called and what colour it wears. They didn't:
// each hardcoded 'bug' and 'idea', so a new category rendered as an idea on the
// triage page — which is a fine way to lose a safety report in a list of
// suggestions.
//
// 'cleaning' is deliberately NOT here. It doesn't reach the feedback table at
// all: it posts to the cleaning issue inbox, carries its own urgency and photo,
// and the widget branches on it well before this list matters.

export type FeedbackType = 'bug' | 'idea' | 'incident' | 'safety'

export interface FeedbackTypeSpec {
  key: FeedbackType
  /** Chip on the widget. */
  chip: string
  /** Badge on the triage page. */
  badge: string
  /** Filter tab on the triage page. */
  tab: string
  color: string
  /** What the textarea asks for. */
  placeholder: string
  /** Shown under the box when this type is picked; '' for the everyday ones. */
  note: string
}

// Reported types, in the order the chips sit. Bug and idea first because they
// are the everyday ones; the two that describe something that happened in the
// real world come after.
export const FEEDBACK_TYPES: FeedbackTypeSpec[] = [
  {
    key: 'bug', chip: '🐛 Bug', badge: '🐛 BUG', tab: '🐛 Bugs', color: '#EF4444',
    placeholder: 'What went wrong?', note: '',
  },
  {
    key: 'idea', chip: '💡 Idea', badge: '💡 IDEA', tab: '💡 Ideas', color: '#F59E0B',
    placeholder: 'What would make this better?', note: '',
  },
  // Charlie, 2026-08-27: "Maybe make a spot for a customer incident reporting
  // and then also a safety category?" Both land in the same punch list he
  // already reads every day rather than in a module nobody opens.
  {
    key: 'incident', chip: '📋 Customer', badge: '📋 CUSTOMER INCIDENT', tab: '📋 Customer', color: '#60A5FA',
    placeholder: 'What happened, and whose order was it?',
    note: 'A complaint or a problem with a customer’s order — who, what, and what was done about it.',
  },
  {
    key: 'safety', chip: '⚠️ Safety', badge: '⚠️ SAFETY', tab: '⚠️ Safety', color: '#F97316',
    placeholder: 'What happened, or what nearly did?',
    note: 'Injuries, near misses, and anything unsafe. If somebody is hurt right now, go get help first — this is the record, not the alarm.',
  },
]

const BY_KEY = new Map(FEEDBACK_TYPES.map(t => [t.key, t]))

/** The spec for a stored type. Unknown types fall back to a neutral note so an
 *  old or hand-entered row still renders instead of masquerading as an idea. */
export function feedbackSpec(type: string | null | undefined): FeedbackTypeSpec {
  return BY_KEY.get((type ?? '') as FeedbackType) ?? {
    key: 'idea', chip: type ?? 'note', badge: `📝 ${(type ?? 'NOTE').toUpperCase()}`,
    tab: type ?? 'note', color: '#A6785A', placeholder: '', note: '',
  }
}
