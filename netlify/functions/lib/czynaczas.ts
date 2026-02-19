import { Departure } from "./types";

// Cache in-memory (działa dopóki instancja Lambdy "żyje")
const CACHE: Record<string, { data: any[]; timestamp: number }> = {};
const CACHE_TTL_MS = 15_000; // 15 sekund
const REQUEST_TIMEOUT_MS = 5_000; // Zwiększamy timeout do 5s dla pewności

interface RawDeparture {
  vehicle_type_id: number;
  line: string;
  direction: string;
  stop_id: string;
  day?: string;
  departure_time: number;
  departure_time_live?: number;
  vehicle_id?: string;
  features?: {
    low_floor?: boolean;
    air_conditioning?: boolean;
    ticket_machine?: boolean;
  };
}

export class CzynaczasClient {
  
  async getDepartures(stopId: string, limit: number = 10): Promise<Departure[]> {
    const url = `https://czynaczas.pl/api/warsaw/timetable/${stopId}?limit=30`; // Pobieramy więcej

    const now = Date.now();
    console.log(`[CzynaczasClient] Requesting departures for stopId=${stopId}`);

    // 1. Check Cache
    if (CACHE[stopId] && (now - CACHE[stopId].timestamp < CACHE_TTL_MS)) {
      console.log(`[CzynaczasClient] CACHE HIT for ${stopId}. Items: ${CACHE[stopId].data.length}`);
      return this.normalize(CACHE[stopId].data, limit);
    }

    console.log(`[CzynaczasClient] API FETCH: ${url}`);

    // 2. Fetch with Timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      console.log(`[CzynaczasClient] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        throw new Error(`External API error: ${response.status}`);
      }

      const text = await response.text();
      console.log(`[CzynaczasClient] Raw response length: ${text.length} chars`);
      
      let rawData: RawDeparture[];
      try {
        rawData = JSON.parse(text);
      } catch (e) {
        console.error(`[CzynaczasClient] JSON Parse Error. Raw text prefix: ${text.substring(0, 200)}...`);
        throw e;
      }

      if (!Array.isArray(rawData)) {
         console.warn(`[CzynaczasClient] Expected array, got ${typeof rawData}:`, rawData);
         rawData = [];
      }

      console.log(`[CzynaczasClient] Parsed ${rawData.length} items for ${stopId}`);
      if (rawData.length > 0) {
        console.log(`[CzynaczasClient] First item sample:`, JSON.stringify(rawData[0]));
      } else {
        console.log(`[CzynaczasClient] Received EMPTY array from API for ${stopId}`);
      }
      
      // Update Cache
      CACHE[stopId] = { data: rawData, timestamp: now };

      const normalized = this.normalize(rawData, limit);
      console.log(`[CzynaczasClient] Normalized ${normalized.length} items (limit=${limit})`);
      return normalized;

    } catch (error: any) {
      console.error(`[CzynaczasClient] Error fetching ${stopId}:`, error);
      
      if (CACHE[stopId]) {
         console.warn(`[CzynaczasClient] CACHE STALE fallback for ${stopId}`);
         return this.normalize(CACHE[stopId].data, limit);
      }
      return []; 
    }
  }

  private normalize(rawData: RawDeparture[], limit: number): Departure[] {
    const departures = rawData.map((raw) => {
      // Prosta heurystyka dla typu
      const isWkd = raw.vehicle_type_id === 2 || raw.line === "WKD" || raw.line === "R1"; 
      const agency = isWkd ? "WKD" : "ZTM";
      const mode = isWkd ? "TRAIN" : "BUS";

      const scheduled = raw.departure_time;
      const live = raw.departure_time_live ?? null;

      let delaySec: number | null = null;
      if (live !== null) {
        delaySec = live - scheduled;
      }

      const dayStr = raw.day || new Date().toISOString().split('T')[0];

      return {
        mode,
        agency,
        route_id: raw.line,
        headsign: raw.direction,
        stop_id: raw.stop_id,
        date: dayStr.replace(/-/g, ''),
        scheduled_sec: scheduled,
        live_sec: live,
        delay_sec: delaySec,
        vehicle_id: raw.vehicle_id || null,
        features: raw.features ? {
          lowFloor: !!raw.features.low_floor,
          airConditioning: !!raw.features.air_conditioning,
          ticketMachine: !!raw.features.ticket_machine
        } : null,
        source_type: String(raw.vehicle_type_id)
      };
    });

    // Sortowanie
    departures.sort((a, b) => {
      const timeA = a.live_sec ?? a.scheduled_sec;
      const timeB = b.live_sec ?? b.scheduled_sec;
      return timeA - timeB;
    });

    return departures.slice(0, limit);
  }
}
