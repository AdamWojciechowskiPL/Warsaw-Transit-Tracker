import { Departure, TripDetails, TripStop } from "./types";

// Cache in-memory (działa dopóki instancja Lambdy "żyje")
const CACHE: Record<string, { data: any[]; timestamp: number }> = {};
const TRIP_CACHE: Record<string, { data: TripDetails; timestamp: number }> = {};
const CACHE_TTL_MS = 15_000; // 15 sekund
const TRIP_CACHE_TTL_MS = 30_000; // 30 sekund
const REQUEST_TIMEOUT_MS = 8_000; // Wydłużony timeout do 8s
const MAX_RETRIES = 2; // Maksymalna liczba powtórzeń w przypadku błędów 5xx
const STOP_DELAY_LOOKUP_CONCURRENCY = 6;

type RawDeparture = Record<string, any>;

type RawTripResponse = {
  shape?: {
    type?: string;
    coordinates?: unknown;
  };
  stops?: unknown;
};

export class CzynaczasClient {
  async getDepartures(stopId: string, limit: number = 10): Promise<Departure[]> {
    const url = `https://czynaczas.pl/api/warsaw/timetable/${stopId}?limit=40`;

    const now = Date.now();
    console.log(`[CzynaczasClient] Requesting departures for stopId=${stopId}`);

    // 1. Check Cache
    if (CACHE[stopId] && (now - CACHE[stopId].timestamp < CACHE_TTL_MS)) {
      console.log(`[CzynaczasClient] CACHE HIT for ${stopId}. Items: ${CACHE[stopId].data.length}`);
      return this.normalize(CACHE[stopId].data, limit);
    }

    console.log(`[CzynaczasClient] API FETCH: ${url}`);

    // 2. Fetch with Retries & Timeout
    let lastError: Error | null = null;
    let rawData: RawDeparture[] | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        console.log(`[CzynaczasClient] Fetch attempt ${attempt}/${MAX_RETRIES + 1}`);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        console.log(`[CzynaczasClient] Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          throw new Error(`External API error: ${response.status}`);
        }

        const text = await response.text();

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

        // Sukces - przerywamy pętlę retries
        break;
      } catch (error: any) {
        lastError = error;
        console.error(`[CzynaczasClient] Error fetching ${stopId} (Attempt ${attempt}):`, error.message);

        // Czekamy chwilę przed kolejną próbą (exponential backoff)
        if (attempt <= MAX_RETRIES) {
          const delayMs = attempt * 1000;
          console.log(`[CzynaczasClient] Retrying in ${delayMs}ms...`);
          await new Promise(res => setTimeout(res, delayMs));
        }
      } finally {
        clearTimeout(timeoutId); // Upewnij się, że timer jest zawsze czyszczony
      }
    }

    if (rawData) {
      console.log(`[CzynaczasClient] Parsed ${rawData.length} items for ${stopId}`);

      // Update Cache
      CACHE[stopId] = { data: rawData, timestamp: Date.now() };

      const normalized = this.normalize(rawData, limit);
      console.log(`[CzynaczasClient] Normalized ${normalized.length} items (limit=${limit})`);
      return normalized;
    } else {
      console.error(`[CzynaczasClient] All attempts failed for ${stopId}. Last error:`, lastError);

      if (CACHE[stopId]) {
        console.warn(`[CzynaczasClient] CACHE STALE fallback for ${stopId}`);
        return this.normalize(CACHE[stopId].data, limit);
      }
      return []; // Bezpieczny fallback na puste dane, by nie wysypywać całej strony
    }
  }

  async getTripDetails(tripId: string): Promise<TripDetails | null> {
    const now = Date.now();
    if (TRIP_CACHE[tripId] && (now - TRIP_CACHE[tripId].timestamp < TRIP_CACHE_TTL_MS)) {
      return TRIP_CACHE[tripId].data;
    }

    const encodedTripId = encodeURIComponent(tripId);
    const url = `https://czynaczas.pl/api/warsaw/trip?trip_id=${encodedTripId}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Trip API error: ${response.status}`);
    }

    const raw = await response.json() as RawTripResponse;
    if (!raw.shape || raw.shape.type !== "LineString" || !Array.isArray(raw.shape.coordinates) || !Array.isArray(raw.stops)) {
      return null;
    }

    const stops = this.normalizeTripStops(raw.stops, tripId);
    const stopsWithLive = await this.enrichStopsWithLiveDelay(stops);

    const details: TripDetails = {
      trip_id: tripId,
      shape: {
        type: "LineString",
        coordinates: raw.shape.coordinates as Array<[number, number]>
      },
      stops: stopsWithLive,
    };

    TRIP_CACHE[tripId] = { data: details, timestamp: Date.now() };
    return details;
  }

  private async enrichStopsWithLiveDelay(stops: TripStop[]): Promise<TripStop[]> {
    const results: TripStop[] = [...stops];

    let index = 0;
    const workers = Array.from({ length: Math.min(STOP_DELAY_LOOKUP_CONCURRENCY, stops.length) }).map(async () => {
      while (index < stops.length) {
        const currentIndex = index++;
        const stop = stops[currentIndex];
        const live = await this.getTripLiveAtStop(stop.stop_id, stop.trip_id);

        if (live !== null) {
          const delaySec = live - stop.scheduled_sec;
          results[currentIndex] = {
            ...stop,
            estimated_live_sec: live,
            delay_sec: delaySec,
          };
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  private async getTripLiveAtStop(stopId: string, tripId: string): Promise<number | null> {
    try {
      const departures = await this.getDepartures(stopId, 40);
      const match = departures.find((d) => d.trip_id === tripId);
      return match?.live_sec ?? null;
    } catch (error) {
      console.warn(`[CzynaczasClient] Trip live lookup failed for stop=${stopId}, trip=${tripId}`, error);
      return null;
    }
  }

  private normalizeTripStops(rawStops: unknown, fallbackTripId: string): TripStop[] {
    if (!Array.isArray(rawStops)) return [];

    return rawStops
      .map((item): TripStop | null => {
        if (!Array.isArray(item) || item.length < 8) return null;

        const [tripId, scheduledSec, seq, _variant, stopId, stopName, lat, lon] = item;

        if (typeof stopId !== "string" || typeof stopName !== "string") return null;

        return {
          trip_id: typeof tripId === "string" ? tripId : fallbackTripId,
          stop_id: stopId,
          stop_name: stopName,
          lat: Number(lat),
          lon: Number(lon),
          seq: Number(seq),
          scheduled_sec: Number(scheduledSec),
          estimated_live_sec: null,
          delay_sec: null,
        };
      })
      .filter((s): s is TripStop => s !== null)
      .sort((a, b) => a.seq - b.seq);
  }

  private normalizeDate(raw: RawDeparture): string {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');

    // Nowszy schemat: date = "YYYYMMDD"
    if (typeof raw.date === 'string' && /^\d{8}$/.test(raw.date)) {
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

    return departures.slice(0, limit);
  }
}
