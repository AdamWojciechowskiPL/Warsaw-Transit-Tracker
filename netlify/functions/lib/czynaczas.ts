import { Departure } from "./types";

// Cache in-memory (działa dopóki instancja Lambdy "żyje")
const CACHE: Record<string, { data: any[]; timestamp: number }> = {};
const CACHE_TTL_MS = 15_000; // 15 sekund
const REQUEST_TIMEOUT_MS = 5_000; // Zwiększamy timeout do 5s dla pewności

// Czynaczas zwraca różne schematy (historycznie i zależnie od regionu/źródła):
// - starszy: { vehicle_type_id, line, direction, stop_id, day, departure_time, departure_time_live, vehicle_id, features }
// - nowszy (częsty dla WKD): { trip_id, route_id, trip_headsign, stop_id, date, departure_time, departure_time_live, type, vehicle_id, ... }

type RawDeparture = Record<string, any>;

export class CzynaczasClient {
  async getDepartures(stopId: string, limit: number = 10): Promise<Departure[]> {
    const url = `https://czynaczas.pl/api/warsaw/timetable/${stopId}?limit=40`; // Pobieramy więcej by rec engine miał z czego filtrować

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

  private normalizeDate(raw: RawDeparture): string {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');

    // Nowszy schemat: date = "YYYYMMDD"
    if (typeof raw.date === 'string' && /^\\d{8}$/.test(raw.date)) {
      return raw.date;
    }

    // Starszy schemat: day = "YYYY-MM-DD"
    if (typeof raw.day === 'string') {
      return raw.day.replace(/-/g, '');
    }

    return today;
  }

  private normalize(rawData: RawDeparture[], limit: number): Departure[] {
    const departures = rawData.map((raw) => {
      const vehicleTypeId = typeof raw.vehicle_type_id === 'number'
        ? raw.vehicle_type_id
        : (typeof raw.type === 'string' ? parseInt(raw.type, 10) : (typeof raw.type === 'number' ? raw.type : 0));

      const routeId = String(raw.line ?? raw.route_id ?? "");
      const headsign = String(raw.direction ?? raw.trip_headsign ?? "");

      // Prosta heurystyka dla typu
      const isWkd = vehicleTypeId === 2 || routeId === "WKD" || routeId === "R1";
      const agency = isWkd ? "WKD" : "ZTM";
      const mode = isWkd ? "TRAIN" : "BUS";

      const scheduled = Number(raw.departure_time ?? 0);
      const live = (raw.departure_time_live !== undefined && raw.departure_time_live !== null)
        ? Number(raw.departure_time_live)
        : null;

      let delaySec: number | null = null;
      if (live !== null) {
        delaySec = live - scheduled;
      }

      const date = this.normalizeDate(raw);

      return {
        trip_id: (typeof raw.trip_id === 'string' ? raw.trip_id : null),
        mode,
        agency,
        route_id: routeId,
        headsign,
        stop_id: String(raw.stop_id ?? ""),
        date,
        scheduled_sec: scheduled,
        live_sec: live,
        delay_sec: delaySec,
        vehicle_id: (typeof raw.vehicle_id === 'string' ? raw.vehicle_id : null),
        features: raw.features ? {
          lowFloor: !!(raw.features.low_floor ?? raw.features.lowFloor),
          airConditioning: !!(raw.features.air_conditioning ?? raw.features.airConditioning),
          ticketMachine: !!(raw.features.ticket_machine ?? raw.features.ticketMachine)
        } : null,
        source_type: String(vehicleTypeId || "unknown")
      };
    });

    // Sortowanie
    departures.sort((a, b) => {
      const timeA = a.live_sec ?? a.scheduled_sec;
      const timeB = b.live_sec ?? b.scheduled_sec;
      return timeA - timeB;
    });

    // ZWRACAMY WSZYSTKO BEZ OBCINANIA DO limit - obcięcie limit nastąpi po filtracji kierunków w silniku rekomendacji (w RecommendationEngine)
    // "limit" zostanie przeniesiony jako filtr zwracany na samym koncu logiki RecommendationEngine.
    return departures;
  }
}