import { Departure, RouteProfile, RouteSegment, TransferConfig, TransferOption, StopVariantConfig } from "./types";
import { CzynaczasClient } from "./czynaczas";

interface ProfileData {
  profile: RouteProfile;
  config: TransferConfig;
  segments: RouteSegment[];
}

type TrainCandidate = {
  board: Departure;
  transfer: Departure | null;
  transfer_time_sec: number;
  warnings: string[];
};

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
    console.log(`[RecEngine] Request params: limit=${limit}`);
    console.log(`[RecEngine] Transfer config snapshot: exit_buffer_sec=${config.exit_buffer_sec}, min_transfer_buffer_sec=${config.min_transfer_buffer_sec}, walk_times_keys=${Object.keys(config.walk_times || {}).length}`);

    // Znajdź segmenty TRAIN i BUS
    const trainSegment = segments.find(s => s.mode === 'TRAIN');
    const busSegment = segments.find(s => s.mode === 'BUS');

    if (!trainSegment || !busSegment) {
      console.error(`[RecEngine] Missing segments! Train: ${!!trainSegment}, Bus: ${!!busSegment}`);
      throw new Error('Profile must have both TRAIN and BUS segments');
    }

    console.log(`[RecEngine] Segment snapshot: train(from=${trainSegment.from_stop_id}, to=${trainSegment.to_stop_id}, allowed_routes=${(trainSegment.allowed_route_ids || []).join(',') || '-'})`);
    console.log(`[RecEngine] Segment snapshot: bus(from=${busSegment.from_stop_id}, allowed_routes=${(busSegment.allowed_route_ids || []).join(',') || '-'}, has_variants=${!!busSegment.stop_variants})`);

    const trainBoardStopId = trainSegment.from_stop_id;
    if (!trainBoardStopId) throw new Error('TRAIN segment missing from_stop_id');

    const trainTransferStopId = trainSegment.to_stop_id;

    // Zbierz wszystkie stop_id dla autobusów (z wariantami)
    const busStopIds = this.collectBusStopIds(busSegment);
    console.log(`[RecEngine] Bus stops to fetch: ${busStopIds.join(', ')}`);

    let wkdStatus: "available" | "unavailable" = "available";
    let ztmStatus: "available" | "unavailable" = "available";

    // Pobierz dane WKD (boarding)
    let trainBoardDepartures: Departure[] = [];
    try {
      console.log(`[RecEngine] Fetching WKD (board) for stop ${trainBoardStopId}`);
      trainBoardDepartures = await this.client.getDepartures(trainBoardStopId, 20); // Pobieramy więcej by mieć z czego filtrować
      console.log(`[RecEngine] Fetched ${trainBoardDepartures.length} WKD departures (board)`);
      console.log(`[RecEngine] WKD board sample: ${this.describeDepartureWindow(trainBoardDepartures)}`);
      if (trainBoardDepartures.length === 0) wkdStatus = "unavailable";
    } catch (e) {
      console.error('[RecEngine] WKD board fetch error:', e);
      wkdStatus = "unavailable";
    }

    // Pobierz dane WKD (transfer stop / arrival proxy)
    let trainTransferDepartures: Departure[] = [];
    if (trainTransferStopId) {
      try {
        console.log(`[RecEngine] Fetching WKD (transfer) for stop ${trainTransferStopId}`);
        trainTransferDepartures = await this.client.getDepartures(trainTransferStopId, 30);
        console.log(`[RecEngine] Fetched ${trainTransferDepartures.length} WKD departures (transfer)`);
        console.log(`[RecEngine] WKD transfer sample: ${this.describeDepartureWindow(trainTransferDepartures)}`);
      } catch (e) {
        console.error('[RecEngine] WKD transfer fetch error:', e);
      }
    } else {
      console.warn('[RecEngine] TRAIN segment has no to_stop_id; falling back to board time for transfer calculations');
    }

    const trainCandidates = this.buildTrainCandidates(trainBoardDepartures, trainTransferDepartures, trainTransferStopId);
    console.log(`[RecEngine] Built ${trainCandidates.length} train candidates`);

    // Pobierz dane ZTM dla każdego stop_id
    const busDataByStop: Record<string, Departure[]> = {};
    for (const stopId of busStopIds) {
      try {
        console.log(`[RecEngine] Fetching ZTM for stop ${stopId}`);
        const deps = await this.client.getDepartures(stopId, 20);
        busDataByStop[stopId] = deps;
        console.log(`[RecEngine] Fetched ${deps.length} ZTM departures for ${stopId}`);
        console.log(`[RecEngine] ZTM ${stopId} sample: ${this.describeDepartureWindow(deps)}`);
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
    const options = this.computeOptions(trainCandidates, busSegment, busDataByStop, config, limit);
    console.log(`[RecEngine] Generated ${options.length} options`);
    if (options.length > 0) {
      console.log(`[RecEngine] Top options snapshot: ${options.slice(0, Math.min(options.length, 3)).map(o => `${o.bus.route_id}${o.bus_stop_variant ? `/${o.bus_stop_variant}` : ''}:buffer=${o.buffer_sec}s,risk=${o.risk},score=${o.score}`).join(' | ')}`);
    }

    return {
      options,
      meta: {
        profile_id: profile.id,
        timestamp: new Date().toISOString(),
        live_status: { wkd: wkdStatus, ztm: ztmStatus }
      }
    };
  }

  private buildTrainCandidates(
    boardDepartures: Departure[],
    transferDepartures: Departure[],
    transferStopId: string | null
  ): TrainCandidate[] {
    const byTripId = new Map<string, Departure>();
    for (const d of transferDepartures) {
      if (d.trip_id) byTripId.set(d.trip_id, d);
    }

    // Filtrujemy odjazdy z przystanku początkowego tylko do tych,
    // które faktycznie pojawiają się na przystanku przesiadkowym (odpowiedni kierunek).
    let filteredBoardDepartures = boardDepartures;
    if (transferStopId && byTripId.size > 0) {
      filteredBoardDepartures = boardDepartures.filter(board => {
        if (!board.trip_id) return true; // Zostawiamy te bez ID, by nie tracić danych gdy brakuje trip_id
        return byTripId.has(board.trip_id); // Pociąg musi pojawić się na stacji docelowej
      });
      console.log(`[RecEngine] Filtered WKD departures by direction: ${boardDepartures.length} -> ${filteredBoardDepartures.length}`);
      console.log(`[RecEngine] Direction filter matched trip_id count: ${byTripId.size}`);
    }

    const candidates = filteredBoardDepartures.map((board) => {
      const warnings: string[] = [];

      let transfer: Departure | null = null;
      if (transferStopId && board.trip_id) {
        transfer = byTripId.get(board.trip_id) ?? null;
        if (!transfer) {
          warnings.push(`Brak dopasowania trip_id na stacji przesiadkowej (${transferStopId}); użyto czasu z przystanku startowego`);
        }
      } else if (transferStopId && !board.trip_id) {
        warnings.push(`Brak trip_id dla WKD; nie można policzyć czasu na stacji przesiadkowej (${transferStopId})`);
      }

      const transferTime = transfer ? (transfer.live_sec ?? transfer.scheduled_sec) : (board.live_sec ?? board.scheduled_sec);

      return {
        board,
        transfer,
        transfer_time_sec: transferTime,
        warnings
      };
    });

    const withTransferMatch = candidates.filter(c => !!c.transfer).length;
    const withWarnings = candidates.filter(c => c.warnings.length > 0).length;
    console.log(`[RecEngine] Train candidate diagnostics: matched_transfer=${withTransferMatch}, without_transfer=${candidates.length - withTransferMatch}, candidates_with_warnings=${withWarnings}`);

    return candidates;
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
    trainCandidates: TrainCandidate[],
    busSegment: RouteSegment,
    busDataByStop: Record<string, Departure[]>,
    config: TransferConfig,
    limit: number
  ): TransferOption[] {
    const options: TransferOption[] = [];
    const allowedBusLines = busSegment.allowed_route_ids || [];
    console.log(`[RecEngine] Allowed bus lines: ${allowedBusLines.join(', ')}`);

    const stats = {
      trainCandidatesConsidered: 0,
      variantChecks: 0,
      missingBusDepartures: 0,
      risk: { LOW: 0, MED: 0, HIGH: 0 }
    };

    // Dla każdego odjazdu pociągu (max 8 najbliższych po filtracji)
    const trainTop = trainCandidates.slice(0, 8);
    stats.trainCandidatesConsidered = trainTop.length;
    console.log(`[RecEngine] Evaluating top train candidates: ${trainTop.length}/${trainCandidates.length}`);

    for (const cand of trainTop) {
      const trainTransferTime = cand.transfer_time_sec;
      console.log(`[RecEngine] Train candidate ${cand.board.route_id ?? '-'} trip=${cand.board.trip_id ?? 'n/a'} transfer_time=${trainTransferTime}`);

      // Dla każdej linii autobusowej
      for (const busLine of allowedBusLines) {
        // Znajdź warianty przystanków dla tej linii
        const variants = this.getVariantsForLine(busSegment, busLine);

        for (const { stopId, variant } of variants) {
          stats.variantChecks += 1;
          // Czas dojścia (w sekundach)
          const walkTimeMin = this.resolveWalkTimeMinutes(config.walk_times, busLine, variant);
          const walkTimeSec = walkTimeMin * 60;

          const readySec = trainTransferTime + config.exit_buffer_sec + walkTimeSec;

          // Znajdź pierwszy autobus po readySec
          const busDeps = (busDataByStop[stopId] || [])
            .filter(d => d.route_id === busLine);

          const busDep = busDeps.find(d => {
            const busTime = d.live_sec ?? d.scheduled_sec;
            return busTime >= readySec;
          });

          if (!busDep) {
            stats.missingBusDepartures += 1;
            console.log(`[RecEngine] No bus match: line=${busLine}, variant=${variant ?? '-'}, stop=${stopId}, ready_sec=${readySec}, checked_departures=${busDeps.length}`);
            continue;
          }

          const busTime = busDep.live_sec ?? busDep.scheduled_sec;
          const bufferSec = busTime - readySec;

          // Ostrzeżenia
          const warnings: string[] = [];
          warnings.push(...cand.warnings);
          if (!cand.board.live_sec) warnings.push('Brak danych live WKD – większe ryzyko');
          if (!busDep.live_sec) warnings.push(`Brak danych live ZTM dla linii ${busLine}`);

          // Ryzyko
          let risk: "LOW" | "MED" | "HIGH";
          if (bufferSec < config.min_transfer_buffer_sec) {
            risk = "HIGH";
          } else if (bufferSec <= 300) {
            risk = "MED";
          } else {
            risk = "LOW";
          }
          // Kara za brak live
          if (!cand.board.live_sec && risk === "LOW") risk = "MED";
          stats.risk[risk] += 1;

          // Score: wyższy = lepszy (preferuj duży bufor, karz brak live i wysokie ryzyko)
          let score = bufferSec;
          if (!cand.board.live_sec) score -= 120;
          if (!busDep.live_sec) score -= 60;
          if (risk === "HIGH") score -= 300;
          if (risk === "MED") score -= 100;

          const optId = `${cand.board.scheduled_sec}_${busLine}_${variant ?? 'X'}`;

          options.push({
            id: optId,
            train: cand.board,
            train_transfer: cand.transfer,
            train_transfer_time_sec: trainTransferTime,
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

    console.log(`[RecEngine] Option diagnostics: variant_checks=${stats.variantChecks}, missing_bus_matches=${stats.missingBusDepartures}, risk_LOW=${stats.risk.LOW}, risk_MED=${stats.risk.MED}, risk_HIGH=${stats.risk.HIGH}`);

    return options.slice(0, limit);
  }

  private describeDepartureWindow(departures: Departure[]): string {
    if (departures.length === 0) return 'none';

    const sorted = [...departures]
      .sort((a, b) => (a.live_sec ?? a.scheduled_sec) - (b.live_sec ?? b.scheduled_sec));

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const liveCount = departures.filter(d => !!d.live_sec).length;

    return `count=${departures.length}, first=${first.route_id || '-'}@${this.toIsoTime(first.live_sec ?? first.scheduled_sec)}, last=${last.route_id || '-'}@${this.toIsoTime(last.live_sec ?? last.scheduled_sec)}, live=${liveCount}/${departures.length}`;
  }

  private toIsoTime(sec: number): string {
    return new Date(sec * 1000).toISOString();
  }

  private resolveWalkTimeMinutes(
    walkTimes: Record<string, number>,
    busLine: string,
    variant: string | null
  ): number {
    // Obsługujemy oba style kluczy: "401_A" oraz "401A".
    if (variant) {
      const k1 = `${busLine}_${variant}`;
      const k2 = `${busLine}${variant}`;
      if (walkTimes[k1] !== undefined) return walkTimes[k1];
      if (walkTimes[k2] !== undefined) return walkTimes[k2];
    }
    if (walkTimes[busLine] !== undefined) return walkTimes[busLine];
    return 5;
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
