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
