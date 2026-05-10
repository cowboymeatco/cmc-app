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
}

// ── Harvest Appointments ──────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'PendingRequest'
  | 'Booked'
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
  box_identifier:        string | null
  notes:                 string | null
}

// ── Harvest ───────────────────────────────────────────────────────────────────

export interface HarvestLog {
  id:                     string
  created_at:             string
  appointment_id:         string
  harvest_date:           string
  species:                string
  carcass_tag:            string
  sex:                    string
  live_weight_lbs:        number | null
  hot_carcass_weight_lbs: number | null
  yield_pct:              number | null
  inspector_initials:     string
  intervention_applied:   boolean
  intervention_type:      string
  intervention_temp_f:    number | null
  final_carcass_temp_f:   number | null
  ccp_pass:               boolean
  performed_by:           string
  notes:                  string
  status:                 string   // 'chilling' | 'complete'
  is_verification:        boolean
  direct_observation:     boolean
  over_30_months:         boolean
  producer:               string
  ear_tag:                string
  breed:                  string
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
  id:                   string
  created_at:           string
  recorded_date:        string        // ISO date
  recorded_time:        string | null // HH:MM:SS
  showcase_freezer_f:   number | null
  showcase_cooler_f:    number | null
  retail_freezer_f:     number | null
  custom_freezer_f:     number | null
  new_carcass_cooler_f: number | null
  old_carcass_cooler_f: number | null
  initials:             string
  notes:                string
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
}
