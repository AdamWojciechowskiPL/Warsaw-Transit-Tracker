// --- DATABASE ENTITIES (zgodne z DDL) ---

export interface AppUser {
  id: string;
  identity_subject: string;
  email: string | null;
  display_name: string | null;
  created_at: Date;
}

export interface RouteProfile {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  is_valid: boolean;
  validation_errors: string[] | null; // JSONB
}

export interface RouteSegment {
  id: string;
  profile_id: string;
  seq: number;
  mode: 'TRAIN' | 'BUS' | 'WALK';
  agency: 'WKD' | 'ZTM' | null;
  from_stop_id: string | null;
  to_stop_id: string | null;
  allowed_route_ids: string[]; // JSONB: np. ['189', '401']
  stop_variants: StopVariantConfig | null; // JSONB
  notes: string | null;
}

export interface TransferConfig {
  id: string;
  profile_id: string;
  exit_buffer_sec: number;
  min_transfer_buffer_sec: number;
  walk_times: Record<string, number>; // JSONB: np. {"189": 3, "401_A": 5}
}

// Struktura JSONB dla wariantów przystanków
export type StopVariantConfig = Record<string, Array<{
  stop_id: string;
  variant: string | null; // "A", "B" lub null
  note?: string;
}>>;

// --- DOMAIN DTOs (zgodne ze specyfikacją 6.2) ---

export interface Departure {
  // Uwaga: Czynaczas zwraca różne schematy dla WKD/ZTM; trip_id może być null.
  trip_id?: string | null;

  mode: "TRAIN" | "BUS";
  agency: "WKD" | "ZTM";
  route_id: string;
  headsign: string;
  stop_id: string;
  date: string;            // YYYYMMDD
  scheduled_sec: number;
  live_sec: number | null;
  delay_sec: number | null;
  vehicle_id: string | null;
  features: {
    lowFloor: boolean;
    airConditioning: boolean;
    ticketMachine: boolean;
  } | null;
  source_type: string;
}

export interface TransferOption {
  id: string;
  train: Departure;
  // Opcjonalnie: dla segmentu TRAIN możemy policzyć przesiadkę na podstawie czasu na to_stop_id.
  train_transfer?: Departure | null;
  train_transfer_time_sec?: number;

  bus: Departure;
  bus_stop_variant: string | null; // "A", "B"
  walk_sec: number;
  exit_buffer_sec: number;
  min_transfer_buffer_sec: number;
  ready_sec: number;
  buffer_sec: number;
  risk: "LOW" | "MED" | "HIGH";
  score: number;
  warnings: string[];
}