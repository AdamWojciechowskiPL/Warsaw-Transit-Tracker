export interface AppUser {
  id: string;
  email: string | null;
  display_name: string | null;
}

export interface RouteProfile {
  id: string;
  name: string;
  is_active: boolean;
  is_valid: boolean;
  validation_errors: string[] | null;
}

export interface RouteSegment {
  id: string;
  profile_id: string;
  seq: number;
  mode: 'TRAIN' | 'BUS' | 'WALK';
  agency: string | null;
  from_stop_id: string | null;
  to_stop_id: string | null;
  allowed_route_ids: string[];
  stop_variants: any | null;
  notes: string | null;
}

export interface TransferConfig {
  exit_buffer_sec: number;
  min_transfer_buffer_sec: number;
  walk_times: Record<string, number>;
}

export interface Departure {
  // Backend może dosłać trip_id dla WKD (używane do dopasowania czasu na stacji przesiadkowej).
  trip_id?: string | null;

  mode: 'TRAIN' | 'BUS';
  agency: 'WKD' | 'ZTM';
  route_id: string;
  headsign: string;
  stop_id: string;
  scheduled_sec: number;
  live_sec: number | null;
  delay_sec: number | null;
  vehicle_id: string | null;
  features: {
    lowFloor: boolean;
    airConditioning: boolean;
    ticketMachine: boolean;
  } | null;
}

export interface TransferOption {
  id: string;
  train: Departure;
  // Opcjonalnie: backend może dosłać rekord WKD na stacji przesiadkowej.
  train_transfer?: Departure | null;
  train_transfer_time_sec?: number;

  bus: Departure;
  bus_stop_variant: string | null;
  walk_sec: number;
  exit_buffer_sec: number;
  min_transfer_buffer_sec: number;
  ready_sec: number;
  buffer_sec: number;
  risk: 'LOW' | 'MED' | 'HIGH';
  score: number;
  warnings: string[];
}

export interface RecommendationResult {
  options: TransferOption[];
  meta: {
    profile_id: string;
    timestamp: string;
    live_status: {
      wkd: 'available' | 'unavailable';
      ztm: 'available' | 'unavailable';
    };
  };
}
