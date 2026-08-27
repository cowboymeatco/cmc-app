import { MIN_BATCH_LBS, type GameSheet } from './gameCuts'

// House rules that ride along with a wild game order.
//
// These are the things the counter says out loud every time and the floor has
// to be told every time — "jerky comes off roasts", "steaked roasts get
// separated and marked". Written down here rather than in somebody's head, so
// they appear on the order screen while the hunter is choosing AND print on the
// work order that goes to the table.
//
// ── Adding a rule ─────────────────────────────────────────────────────────
// Add an entry to GAME_RULES. `applies` gets the whole sheet and returns true
// when the rule is relevant. `audience` decides where it shows up:
//   'hunter' — on the order screen only (something they should know before
//              they choose)
//   'floor'  — on the printed work order only (a handling instruction)
//   'both'   — both places
// Nothing else needs changing; the screen and the printer both read this list.

export type RuleAudience = 'hunter' | 'floor' | 'both'
export type RuleSeverity = 'info' | 'warn'

export interface GameRule {
  key:      string
  audience: RuleAudience
  severity: RuleSeverity
  /** Short line. On the work order this prints in bold. */
  title:    string
  /** The why, in one or two sentences. */
  detail:   string
  applies:  (sheet: GameSheet) => boolean
}

const picks = (sheet: GameSheet) => sheet.smokehouse ?? []
const has = (sheet: GameSheet, category: string) => picks(sheet).some(p => p.category === category)
const service = (sheet: GameSheet, key: string) => (sheet.services ?? {})[key] === 'true'

export const GAME_RULES: GameRule[] = [
  {
    key: 'jerky_from_roasts',
    audience: 'both',
    severity: 'warn',
    title: 'Jerky is made from roasts, not trim',
    detail:
      'Jerky is sliced off whole muscle, so the roasts have to be pulled and set aside ' +
      'before anything else goes near the grinder. A cooler that is all trim cannot make ' +
      'jerky — and roasts spent on jerky are roasts that cannot also be steaked.',
    applies: sheet => has(sheet, 'jerky'),
  },
  {
    key: 'steaked_roasts_marked',
    audience: 'both',
    severity: 'warn',
    title: 'Steaked roasts: SEPARATE AND MARK',
    detail:
      'Roasts going to steaks must be separated from the rest of the order and marked for ' +
      'the cut team before they leave receiving. Once they are in with the trim nobody can ' +
      'tell them apart, and they get ground.',
    applies: sheet => service(sheet, 'slicing'),
  },
  {
    key: 'batch_minimum',
    audience: 'both',
    severity: 'info',
    title: `${MIN_BATCH_LBS} lb minimum per flavour`,
    detail:
      `The smokehouse will not run a flavour under ${MIN_BATCH_LBS} lb. Anything short has to ` +
      'be topped up with beef or pork trim at market price — which is a cost, so it gets ' +
      'agreed at the counter, not discovered at packout.',
    applies: sheet => picks(sheet).length > 0,
  },
  {
    key: 'cure_before_smoke',
    audience: 'floor',
    severity: 'info',
    title: 'Cured product runs before the smokehouse slot',
    detail:
      'Anything on this order marked for curing has to be in cure before its smokehouse slot, ' +
      'not after — check the cure time against the schedule when the job is booked.',
    applies: sheet => service(sheet, 'curing'),
  },
  {
    key: 'not_for_sale',
    audience: 'floor',
    severity: 'warn',
    title: 'NOT FOR SALE — customer’s own game',
    detail:
      'Wild game is not inspected and never enters commerce. Keep it off inspected product, ' +
      'label every package NOT FOR SALE, and do not put any of it on a retail shelf.',
    applies: () => true,
  },
]

/** The rules that apply to this order, for a given audience. */
export function rulesFor(sheet: GameSheet, audience: 'hunter' | 'floor'): GameRule[] {
  return GAME_RULES.filter(r =>
    (r.audience === audience || r.audience === 'both') && r.applies(sheet))
}
