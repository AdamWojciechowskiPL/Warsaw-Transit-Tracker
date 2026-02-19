import { Departure, RouteProfile, RouteSegment, TransferConfig, TransferOption, StopVariantConfig } from "./types";
import { CzynaczasClient } from "./czynaczas";

interface ProfileData {
  profile: RouteProfile;
  config: TransferConfig;
  segments: RouteSegment[];
}

export class RecommendationEngine {
  private client: CzynaczasClient;

  constructor() {
    this.client = new CzynaczasClient();
  }

  async getRecommendations(profileData: ProfileData, limit: number = 5): Promise<{
    options: TransferOption[];
    meta: {
      profile_id: string;
      timestamp: string;
      live_status: { wkd: "available" | "unavailable"; ztm: "available" | "unavailable" };
    };
  }> {
    const { profile, config, segments } = profileData;
    console.log(`[RecEngine] Starting recommendation for profile: ${profile.id} (${profile.name})`);

    // Znajdź segmenty TRAIN i BUS
    const trainSegment = segments.find(s => s.mode === 'TRAIN');
    const busSegment = segments.find(s => s.mode === 'BUS');

    if (!trainSegment || !busSegment) {
      console.error(`[RecEngine] Missing segments! Train: ${!!trainSegment}, Bus: ${!!busSegment}`);
      throw new Error('Profile must have both TRAIN and BUS segments');
    }

    const trainStopId = trainSegment.from_stop_id;
    if (!trainStopId) throw new Error('TRAIN segment missing from_stop_id');

    // Zbierz wszystkie stop_id dla autobusów (z wariantami)
    const busStopIds = this.collectBusStopIds(busSegment);
    console.log(`[RecEngine] Bus stops to fetch: ${busStopIds.join(', ')}`);

    let wkdStatus: "available" | "unavailable" = "available";
    let ztmStatus: "available" | "unavailable" = "available";

    // Pobierz dane WKD
    let trainDepartures: Departure[] = [];
    try {
      console.log(`[RecEngine] Fetching WKD for stop ${trainStopId}`);
      trainDepartures = await this.client.getDepartures(trainStopId, 10);
      console.log(`[RecEngine] Fetched ${trainDepartures.length} WKD departures`);
      if (trainDepartures.length === 0) wkdStatus = "unavailable";
    } catch (e) {
      console.error('[RecEngine] WKD fetch error:', e);
      wkdStatus = "unavailable";
    }

    // Pobierz dane ZTM dla każdego stop_id
    const busDataByStop: Record<string, Departure[]> = {};
    for (const stopId of busStopIds) {
      try {
        console.log(`[RecEngine] Fetching ZTM for stop ${stopId}`);
        const deps = await this.client.getDepartures(stopId, 20);
        busDataByStop[stopId] = deps;
        console.log(`[RecEngine] Fetched ${deps.length} ZTM departures for ${stopId}`);
      } catch (e) {
        console.error(`[RecEngine] ZTM fetch error for ${stopId}:`, e);
        busDataByStop[stopId] = [];
        ztmStatus = "unavailable";
      }
    }

    if (Object.values(busDataByStop).every(d => d.length === 0)) {
      console.warn(`[RecEngine] All ZTM stops returned 0 departures`);
      ztmStatus = "unavailable";
    }

    // Generuj opcje transferu
    console.log(`[RecEngine] Computing options...`);
    const options = this.computeOptions(trainDepartures, busSegment, busDataByStop, config, limit);
    console.log(`[RecEngine] Generated ${options.length} options`);

    return {
      options,
      meta: {
        profile_id: profile.id,
        timestamp: new Date().toISOString(),
        live_status: { wkd: wkdStatus, ztm: ztmStatus }
      }
    };
  }

  private collectBusStopIds(busSegment: RouteSegment): string[] {
    const stopIds = new Set<string>();

    if (busSegment.stop_variants) {
      // Zbierz wszystkie stop_ids z wariantów
      for (const [_line, variants] of Object.entries(busSegment.stop_variants as StopVariantConfig)) {
        for (const v of variants) {
          stopIds.add(v.stop_id);
        }
      }
    } else if (busSegment.from_stop_id) {
      stopIds.add(busSegment.from_stop_id);
    }

    return Array.from(stopIds);
  }

  private computeOptions(
    trainDepartures: Departure[],
    busSegment: RouteSegment,
    busDataByStop: Record<string, Departure[]>,
    config: TransferConfig,
    limit: number
  ): TransferOption[] {
    const options: TransferOption[] = [];
    const allowedBusLines = busSegment.allowed_route_ids || [];
    console.log(`[RecEngine] Allowed bus lines: ${allowedBusLines.join(', ')}`);

    // Dla każdego odjazdu pociągu (max 8 najbliższych)
    const trainCandidates = trainDepartures.slice(0, 8);

    for (const train of trainCandidates) {
      const trainTime = train.live_sec ?? train.scheduled_sec;
      // console.log(`[RecEngine] Processing train: ${train.route_id} at ${trainTime} (${new Date().toLocaleTimeString()})`);

      // Dla każdej linii autobusowej
      for (const busLine of allowedBusLines) {
        // Znajdź warianty przystanków dla tej linii
        const variants = this.getVariantsForLine(busSegment, busLine);

        for (const { stopId, variant } of variants) {
          // Czas dojścia (w sekundach)
          const walkKey = variant ? `${busLine}_${variant}` : busLine;
          const walkTimeSec = ((config.walk_times as Record<string, number>)[walkKey] ?? 5) * 60;

          const readySec = trainTime + config.exit_buffer_sec + walkTimeSec;

          // Znajdź pierwszy autobus po readySec
          const busDeps = (busDataByStop[stopId] || [])
            .filter(d => d.route_id === busLine);

          const busDep = busDeps.find(d => {
            const busTime = d.live_sec ?? d.scheduled_sec;
            return busTime >= readySec;
          });

          if (!busDep) {
             // console.log(`[RecEngine] No bus found for line ${busLine} after ${readySec} (stop: ${stopId})`);
             continue;
          }

          const busTime = busDep.live_sec ?? busDep.scheduled_sec;
          const bufferSec = busTime - readySec;

          // Ostrzeżenia
          const warnings: string[] = [];
          if (!train.live_sec) warnings.push('Brak danych live WKD – większe ryzyko');
          if (!busDep.live_sec) warnings.push(`Brak danych live ZTM dla linii ${busLine}`);

          // Ryzyko
          let risk: "LOW" | "MED" | "HIGH";
          if (bufferSec < 120) {
            risk = "HIGH";
          } else if (bufferSec <= 300) {
            risk = "MED";
          } else {\n            risk = "LOW";\n          }
          // Kara za brak live
          if (!train.live_sec && risk === "LOW") risk = "MED";

          // Score: wyższy = lepszy (preferuj duży bufor, karz brak live i wysokie ryzyko)
          let score = bufferSec;
          if (!train.live_sec) score -= 120;
          if (!busDep.live_sec) score -= 60;
          if (risk === "HIGH") score -= 300;
          if (risk === "MED") score -= 100;

          const optId = `${train.scheduled_sec}_${busLine}_${variant ?? 'X'}`;

          options.push({
            id: optId,
            train,
            bus: busDep,
            bus_stop_variant: variant,
            walk_sec: walkTimeSec,
            exit_buffer_sec: config.exit_buffer_sec,
            min_transfer_buffer_sec: config.min_transfer_buffer_sec,
            ready_sec: readySec,
            buffer_sec: bufferSec,
            risk,
            score,
            warnings
          });
        }
      }
    }

    // Sortuj: najlepszy score (wyższy = lepszy)
    options.sort((a, b) => b.score - a.score);

    return options.slice(0, limit);
  }

  private getVariantsForLine(
    busSegment: RouteSegment,
    busLine: string
  ): Array<{ stopId: string; variant: string | null }> {
    if (busSegment.stop_variants) {
      const sv = busSegment.stop_variants as StopVariantConfig;
      if (sv[busLine]) {
        return sv[busLine].map(v => ({ stopId: v.stop_id, variant: v.variant }));
      }
    }
    // Fallback: użyj from_stop_id segmentu
    if (busSegment.from_stop_id) {
      return [{ stopId: busSegment.from_stop_id, variant: null }];
    }
    return [];
  }
}
