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
