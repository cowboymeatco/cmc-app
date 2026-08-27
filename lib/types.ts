// ── Customers ─────────────────────────────────────────────────────────────────

export interface Customer {
  id:                string
  created_at:        string
  name:              string
  ranch_name:        string
  phone:             string
  email:             string
  preferred_contact: string   // 'Phone Call' | 'Text Message' | 'Email'
  notes:             string
  auth_user_id?:     string | null   // reserved for portal login
  role?:             string   // 'producer' | 'customer' | 'both'
  cut_sheet_count?:  number   // attached by GET /api/customers (list only)
}

// ── Harvest Appointments ──────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'PendingRequest'
  | 'Booked'
  | 'Confirmed'
  | 'InstructionsReceived'
  | 'AnimalIn'
  | 'NoShow'
  | 'Processing'
  | 'Complete'
  | 'Declined'

export type Species = 'Beef' | 'Hog' | 'Lamb' | 'Goat'

export interface AppointmentCustomer {
  id:                          string
  customer_id?:                string | null   // FK to customers table (optional — backward compat)
  customer_name:               string
  portion:                     string   // 'Whole' | 'Half' | 'Quarter'
  // Who gets invoiced for this portion's services (kill share, cut & wrap,
  // value-add). Missing on older records = 'producer'. This is the billing
  // branch trigger: 'customer' means this portion accumulates its own invoice.
  payment_responsibility?:     'producer' | 'customer'
  contact_preference:          string   // 'Email' | 'Text Message' | 'Phone Call'
  contact_value:               string
  linked_cutting_instruction_id: string
  reminder_last_sent_at:       string | null
  reminder_count:              number
}

export interface HarvestAppointment {
  id:               string
  created_at:       string
  harvest_date:     string          // ISO date string
  receive_date?:    string          // scheduled arrival; defaults to the day before harvest, editable
  producer_contact?: string         // producer phone/email for scheduling contact
  species:          Species
  head_count:       number
  source:           string
  notes:            string
  status:           AppointmentStatus
  linked_carcass_id: string
  customers:        AppointmentCustomer[]
}

// ── Cutting Instructions ──────────────────────────────────────────────────────

export interface CuttingInstruction {
  id:           string
  created_at:   string
  status:       string   // 'pending' | 'imported'
  customer_name: string
  species:      string
  data:         Record<string, string>
  // The ACCOUNT the animal is booked under — a business or household, not
  // necessarily the person who filled the sheet out.
  customer_id?: string | null
}

// ── Receiving ─────────────────────────────────────────────────────────────────

export interface AnimalReceivingLog {
  id:              string
  created_at:      string
  appointment_id:  string
  received_at:     string
  live_weight_lbs: number | null
  received_by:     string
  health_cert_no:  string
  brand_insp_no:   string
  notes:           string
  status:          string
  // Per-animal fields (added in receiving overhaul)
  animal_index:    number
  ear_tag:         string
  sex:             string
  breed:           string
  over_30_months:  boolean
  photo_url:       string
}

export interface BoxReceivingLog {
  id:             string
  created_at:     string
  received_at:    string
  vendor:         string
  product:        string
  quantity:       number
  weight_lbs:     number | null
  invoice_no:     string
  lot_no:         string
  temp_f:         number | null
  received_by:    string
  notes:          string
  status:         string
  box_identifier: string | null
}

export interface ProcessingInput {
  id:                    string
  created_at:            string
  session_date:          string
  customer_name:         string | null
  pack_date:             string | null
  description:           string
  weight_lbs:            number | null
  input_type:            string   // 'raw' | 'premade' | 'carcass'
  source_type:           string   // 'general' | 'retail_order' | 'appointment' | 'received_box'
  linked_order_id:       string | null
  linked_appointment_id: string | null
  linked_box_id:         string | null
  linked_harvest_id:     string | null
  box_identifier:        string | null
  notes:                 string | null
  cooler_pulled?:        boolean  // POST response only: this scan pulled the carcass off the rail
}

// ── Harvest ───────────────────────────────────────────────────────────────────

export interface HarvestLog {
  id:                       string
  created_at:               string
  appointment_id:           string
  harvest_date:             string
  species:                  string
  carcass_tag:              string
  sex:                      string
  live_weight_lbs:          number | null
  half_1_weight_lbs:        number | null
  half_2_weight_lbs:        number | null
  hot_carcass_weight_lbs:   number | null
  yield_pct:                number | null
  inspector_initials:       string
  intervention_applied:     boolean
  intervention_type:        string
  intervention_temp_f:      number | null
  final_carcass_temp_f:     number | null
  ccp_pass:                 boolean
  performed_by:             string
  notes:                    string
  status:                   string   // 'chilling' | 'complete'
  is_verification:          boolean
  direct_observation:       boolean
  over_30_months:           boolean
  producer:                 string
  ear_tag:                  string
  breed:                    string
  // Part A / B fields
  knock_time:               string | null
  harvest_order:            number | null
  part_a_complete:          boolean
  part_b_complete:          boolean
  zero_tolerance_pass:      boolean | null
  zero_tolerance_direct_obs: boolean
  initial_cooler_temp_f:    number | null
  kill_type:                'USDA' | 'Custom' | null
}

export interface CorrectiveAction {
  id:                string
  created_at:        string
  car_number:        string        // e.g. '2026-001'
  harvest_log_id:    string | null
  harvest_date:      string
  type:              'zero_tolerance' | 'hot_water'
  monitor_initials:  string | null
  action_1:          string | null
  action_2:          string | null
  action_3:          string | null
  action_4:          string | null
  root_cause:        string | null
  completion_date:   string | null
}

export interface ChillLog {
  id:             string
  created_at:     string
  harvest_log_id: string
  carcass_tag:    string
  checked_at:     string
  carcass_temp_f: number | null
  cooler_temp_f:  number | null
  checked_by:     string
  notes:          string
}

// ── Cold Storage Temperature Log ─────────────────────────────────────────────

export interface ColdStorageLog {
  id:                      string
  created_at:              string
  recorded_date:           string        // ISO date
  recorded_time:           string | null // HH:MM:SS
  showcase_freezer_f:      number | null
  showcase_cooler_f:       number | null
  retail_freezer_f:        number | null
  // The Custom Freezer spans two spaces, each with its own probe — logged
  // separately so a problem in one half can't be averaged away.
  custom_freezer_middle_f: number | null
  custom_freezer_east_f:   number | null
  new_carcass_cooler_f:    number | null
  old_carcass_cooler_f:    number | null
  initials:                string
  notes:                   string
  source:                  string | null  // 'manual' | 'TW-AUTO'
}

// ── Cook Sessions & Readings (ThermoWorks) ────────────────────────────────────

export interface CookSession {
  id:            string
  created_at:    string
  session_name:  string
  device_serial: string | null
  started_at:    string
  ended_at:      string | null
  target_temp_f: number | null
  product:       string | null
  notes:         string | null
  status:        'active' | 'complete'
}

export interface CookReading {
  id:            string
  created_at:    string
  session_id:    string | null
  device_serial: string | null
  read_at:       string
  channel:       number
  channel_label: string | null
  temp_f:        number | null
}

// ── Value Add ────────────────────────────────────────────────────────────────

export type ValueAddStatus = 'pending' | 'in_progress' | 'complete'
export type ValueAddJobType = 'smokehouse' | 'patties' | 'sausage' | 'other'
export type ValueAddSourceType = 'retail_order' | 'cutting_instruction' | 'general'

export interface ValueAddJob {
  id:                            string
  created_at:                    string
  updated_at:                    string
  job_type:                      ValueAddJobType
  description:                   string
  source_type:                   ValueAddSourceType
  linked_order_id:               string | null
  linked_cutting_instruction_id: string | null
  output_plu:                    string | null
  output_item_name:              string
  weight_in_lbs:                 number | null
  weight_out_lbs:                number | null
  // 'boxes' = summed off the Hobart scans in the box label, 'manual' = typed.
  weight_out_source:             'boxes' | 'manual' | null
  assigned_to:                   string
  requested_date:                string
  completed_date:                string | null
  status:                        ValueAddStatus
  notes:                         string
  customer_name:                 string | null
  source_description:            string | null
  tag_code:                      string | null
  // Scheduling — see lib/cookPredict.ts. All nullable: an unscheduled job is
  // still a perfectly good job.
  scheduled_start:               string | null
  predicted_minutes:             number | null
  profile_key:                   string | null
  batch_count:                   number | null
  resource:                      string | null
  schedule_locked:               boolean
}

// ── Cut Schedule ─────────────────────────────────────────────────────────────

export interface CutScheduleItem {
  id:                      string
  schedule_date:           string   // ISO date
  appointment_id:          string
  appointment_customer_id: string
  manual_rank:             number
  locked:                  boolean
  notes:                   string
  created_at:              string
}

// ── Carcass Assignments ──────────────────────────────────────────────────────
// Ties a physical carcass (and a split portion of it) to a specific cut customer
// from the appointment's customers list. The Cut Schedule reads these to show one
// cut job per assigned portion. Carcasses with no rows fall back to the interim
// one-row-per-carcass behaviour.
export interface CarcassAssignment {
  id:                            string
  created_at:                    string
  harvest_log_id:                string
  appointment_id:                string | null
  appointment_customer_id:       string   // = customer.id inside the appointment jsonb
  customer_name:                 string
  portion:                       string   // 'Whole' | 'Half' | 'Quarter'
  linked_cutting_instruction_id: string | null
}

// ── Cure Tags ─────────────────────────────────────────────────────────────────
// Numbered tamper seals zip-tied to hams/bacons on the cut floor. The number
// carries the customer through the cure cooler to the smokehouse.

export interface CureTag {
  id:            string
  created_at:    string
  tag_number:    string   // as printed/scanned, incl. leading zeros
  product:       string   // Ham | Bacon | Shoulder Bacon | Hocks | Jowl | Other
  customer_name: string
  session_date:  string | null
  weight_lbs:    number | null
  status:        'curing' | 'done'
  completed_at:  string | null
  notes:         string | null
  // Set by GET /api/cure-tags?instructions=1 — what this customer's cut sheet
  // says to do with this product once it's out of cure ("Cut in Quarters").
  instruction?:  string | null
  // Whether a cut sheet was found for this name at all. A null `instruction`
  // means two very different things — no sheet under this name (a naming
  // problem for a person to fix) versus a sheet that didn't order this product
  // (nothing to do) — and the tab read the same for both.
  sheetFound?:   boolean
}

// The seals print as 7 digits with a leading zero ("0341981"). Nothing else in
// the plant scans that shape — Hobart barcodes are 13 digits starting '2',
// carcass tags carry dashes, PLUs run 6 digits or fewer and never start with 0 —
// so the shape alone is the signal (Charlie, 2026-08-06: judge by the digits).
export const isCureTagNumber = (code: string) => /^0\d{6}$/.test(code)

// ── Delivery Scans ────────────────────────────────────────────────────────────

export interface DeliveryScan {
  id:           string
  created_at:   string
  delivered_at: string
  driver:       string
  customer:     string
  barcodes:     { barcode: string; scannedAt: string }[]
  notes:        string
  status:       string   // 'pending' | 'reviewed'
  // Where the run dropped the product. 'baker_storage' = the locker in Baker,
  // which is out of our freezer but still ours until the customer collects.
  destination:  string   // 'customer' | 'baker_storage'
  // Processing sessions that rode along, so a run can cover several customers.
  session_refs: { customer_name: string; session_date: string }[]
}

// ── Wild Game ─────────────────────────────────────────────────────────────────
// The hunter side of the plant. Game is not amenable — never inspected, never
// sellable, never commingled — so it lives in its own tables rather than as a
// species on harvest_appointments. See scripts/2026-08-24_wild_game.sql.

export type GameSpecies =
  | 'Deer' | 'Elk' | 'Antelope' | 'Buffalo' | 'Moose' | 'Bear' | 'Sheep' | 'Goat' | 'Other'

// The same stations as the rest of the plant — Receiving, Processing, Value
// Add, Freezer — so game is not a second vocabulary for one species.
export type GameStatus =
  | 'receiving'  // tagged in, nobody has touched it yet
  | 'processing' // on the table: grinding, slicing, packaging
  | 'value_add'  // in or waiting on the smokehouse
  | 'freezer'    // done and waiting for the hunter. Whether they have been
                 // TOLD is notified_at, not a status of its own.
  | 'picked_up'
  | 'abandoned'  // the ones nobody ever comes back for

export type GameCondition =
  'Whole - Hide On' | 'Whole - Skinned' | 'Quartered' | 'Boned Out' | 'Other'

export interface GameIntake {
  id:               string
  created_at:       string
  updated_at:       string
  tag_number:       string   // WG-26-0014 — the claim number on the animal and the hunter's copy
  season:           string
  hunter_name:      string
  hunter_phone:     string
  hunter_email:     string
  customer_id:      string | null
  qbo_customer_id:  string | null
  species:          GameSpecies
  sex:              string
  license_tag_no:   string   // Montana tag — legally travels with the carcass
  hunting_district: string
  harvest_date:     string | null
  condition:        GameCondition
  received_at:      string
  received_by:      string
  weight_in_lbs:    number | null
  // Weighed apart, because roasts and trim do not substitute: steaks and jerky
  // can only come off whole muscle, everything else off the grind.
  roast_lbs:        number | null
  trim_lbs:         number | null
  cape_requested:   boolean
  antlers_returned: boolean
  hide_returned:    boolean
  // Hours against the $60/hr cleaning fee on the slip. cleaning_fee is the
  // legacy boolean, kept in step by the API — hours are what bills.
  cleaning_hours:   number | null
  cleaning_fee:     boolean
  // Slip header fields: what the products are made from, and how it goes home.
  base_material:    string
  finished_product: '' | 'Fresh' | 'Frozen'
  boxes_out:        number | null
  storage_location: string
  status:           GameStatus
  cut_sheet:        Record<string, unknown>
  ready_at:         string | null
  notified_at:      string | null
  picked_up_at:     string | null
  picked_up_by:     string
  notes:            string
  // Attached by GET /api/game (list) — enough to render a board row without
  // a second round trip per animal.
  output_lbs?:      number
  charge_total?:    number
}

export interface GameOutput {
  id:            string
  created_at:    string
  intake_id:     string
  category:      string   // key into game_rates
  flavor:        string
  // Cheese is its own field, exactly as the slip asks it — never inferred from
  // the product name, because "Ghost Pepper" is a cheese and reads like a chilli.
  cheese:        boolean
  cheese_type:   '' | 'CH' | 'PJ' | 'MZ' | 'GP'
  product_name:  string   // rendered from flavour + category + cheese
  plu:           string | null
  weight_lbs:    number
  rate:          number
  qbo_item_id:   string
  qbo_item_name: string
  rate_override: boolean
  // The slip's "# Fat Trim" column — fat goes in per batch, so it lives on the line.
  fat_trim_lbs:  number | null
  fat_trim_kind: '' | 'add_beef_fat' | 'add_pork_fat' | 'add_beef_trim' | 'add_pork_trim'
  notes:         string
}

export interface GameAddition {
  id:            string
  created_at:    string
  intake_id:     string
  kind:          'add_beef_fat' | 'add_pork_fat' | 'add_beef_trim' | 'add_pork_trim'
  weight_lbs:    number
  rate:          number
  qbo_item_id:   string
  qbo_item_name: string
}

export interface GameEvent {
  id:         string
  created_at: string
  intake_id:  string
  event:      string   // 'status' | 'note' | 'notified' | 'weighed'
  detail:     string
  actor:      string
}

// Claim tags print as WG-<yy>-<nnnn>. Nothing else in the plant scans that
// shape — Hobart barcodes are 13 digits starting '2', cure seals are 7 digits
// starting '0', carcass tags carry a Julian date — so the shape alone routes a
// scan to the game board.
export const isGameTagNumber = (code: string) => /^WG-\d{2}-\d{4}$/i.test(code.trim())

/**
 * The hunting season an animal belongs to.
 *
 * Montana's seasons run autumn into the back end of the calendar year, so the
 * season is just the year — except for the January cleanup, where a cow elk
 * shot on 2 January belongs to the season that opened the previous September.
 * Anything in Jan–Mar rolls back a year rather than opening a season nobody
 * has hunted yet.
 */
export function seasonFor(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return String(m <= 3 ? y - 1 : y)
}
