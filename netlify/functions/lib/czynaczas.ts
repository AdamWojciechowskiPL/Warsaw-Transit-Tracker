import { Departure } from "./types";

// Cache in-memory (działa dopóki instancja Lambdy "żyje")
const CACHE: Record<string, { data: any[]; timestamp: number }> = {};
const CACHE_TTL_MS = 15_000; // 15 sekund
const REQUEST_TIMEOUT_MS = 3_000; // 3 sekundy

// Surowe typy z API czynaczas.pl (uproszczone do tego co potrzebujemy)
interface RawDeparture {
  vehicle_type_id: number; // 2 = Train/WKD, 3 = Bus/ZTM
  line: string;
  direction: string;
  stop_id: string; // "wkd_wrako" or numeric
  day: string; // YYYY-MM-DD
  departure_time: number; // seconds from midnight (schedule)
  departure_time_live?: number; // seconds from midnight (live) or null
  vehicle_id?: string;
  features?: {
    low_floor?: boolean;
    air_conditioning?: boolean;
    ticket_machine?: boolean;
  };
}

export class CzynaczasClient {
  
  async getDepartures(stopId: string, limit: number = 10): Promise<Departure[]> {
    const url = `https://czynaczas.pl/api/warsaw/timetable/${stopId}?limit=20`; // Pobieramy nieco więcej, backend utnie

    // 1. Check Cache
    const now = Date.now();
    if (CACHE[stopId] && (now - CACHE[stopId].timestamp < CACHE_TTL_MS)) {
      console.log(`[CACHE HIT] ${stopId}`);
      return this.normalize(CACHE[stopId].data, limit);
    }

    console.log(`[API FETCH] ${stopId}`);

    // 2. Fetch with Timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`External API error: ${response.status}`);
      }

      const rawData: RawDeparture[] = await response.json();
      
      // Update Cache
      CACHE[stopId] = { data: rawData, timestamp: now };

      return this.normalize(rawData, limit);

    } catch (error) {
      console.error(`Error fetching ${stopId}:`, error);
      // Jeśli mamy stare dane w cache (nawet przeterminowane), zwróćmy je awaryjnie w przypadku błędu
      if (CACHE[stopId]) {
         console.warn(`[CACHE STALE fallback] ${stopId}`);
         return this.normalize(CACHE[stopId].data, limit);
      }
      return []; // Lub rzuć błąd w górę, zależnie od strategii
    }
  }

  private normalize(rawData: RawDeparture[], limit: number): Departure[] {
    const departures: Departure[] = rawData.map((raw) => {
      const isWkd = raw.vehicle_type_id === 2; // Zazwyczaj 2 to kolej/WKD w tym API
      const agency = isWkd ? "WKD" : "ZTM";
      const mode = isWkd ? "TRAIN" : "BUS";

      // Normalizacja czasu live
      // WKD często zwraca null w departure_time_live, ZTM zazwyczaj ma wartość
      const scheduled = raw.departure_time;
      const live = raw.departure_time_live ?? null;

      let delaySec: number | null = null;
      if (live !== null) {
        delaySec = live - scheduled;
      }

      return {
        mode,
        agency,
        route_id: raw.line,
        headsign: raw.direction,
        stop_id: raw.stop_id,
        date: raw.day.replace(/-/g, ''), // YYYY-MM-DD -> YYYYMMDD
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

    // Sortowanie: najpierw te co mają odjechać (live lub scheduled)
    departures.sort((a, b) => {
      const timeA = a.live_sec ?? a.scheduled_sec;
      const timeB = b.live_sec ?? b.scheduled_sec;
      return timeA - timeB;
    });

    return departures.slice(0, limit);
  }
}