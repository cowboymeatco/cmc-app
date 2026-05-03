// ── Harvest Appointments ──────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'Booked'
  | 'InstructionsReceived'
  | 'AnimalIn'
  | 'Processing'
  | 'Complete'

export type Species = 'Beef' | 'Hog' | 'Lamb' | 'Goat'

export interface AppointmentCustomer {
  id:                          string
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
