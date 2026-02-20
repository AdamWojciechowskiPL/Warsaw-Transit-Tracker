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

const MAX_TRANSFERS_PER_FIRST_RIDE = 4;

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

    // Pobierz dane ZTM dla każdego stop_id równolegle, z wbudowanym zabezpieczeniem logów
    const busDataByStop: Record<string, Departure[]> = {};
    console.log(`[RecEngine] Entering ZTM fetch phase for stops: ${busStopIds.join(', ')}`);
    
    // Zapobiega timeoutowi całości z winy ZTM poprzez zrównoleglenie i dodatkowe logi
    const busPromises = busStopIds.map(async (stopId) => {
      console.log(`[RecEngine] ---> Requesting ZTM for stop ${stopId}...`);
      try {
        const deps = await this.client.getDepartures(stopId, 20);
        console.log(`[RecEngine] <--- ZTM ${stopId} fetched ${deps.length} departures. Sample: ${this.describeDepartureWindow(deps)}`);
        return { stopId, deps };
      } catch (e) {
        console.error(`[RecEngine] <--- ZTM fetch error for ${stopId}:`, e);
        ztmStatus = "unavailable";
        return { stopId, deps: [] };
      }
    });

    const busResults = await Promise.allSettled(busPromises);
    for (const res of busResults) {
      if (res.status === 'fulfilled') {
        busDataByStop[res.value.stopId] = res.value.deps;
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

    let filteredBoardDepartures = boardDepartures;
    if (transferStopId && byTripId.size > 0) {
      filteredBoardDepartures = boardDepartures.filter(board => {
        if (!board.trip_id) return false;

        const transfer = byTripId.get(board.trip_id);
        if (!transfer) return false;

        return this.absoluteTimeDiffSec(board, transfer) > 0;
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

    // Filtrujemy na wejściu (wcześniej nie było i braliśmy historyczne / z innej daty jako pierwsze!)
    // Sort train candidates chronologically by transfer time
    trainCandidates.sort((a, b) => a.transfer_time_sec - b.transfer_time_sec);
    const trainTop = trainCandidates.slice(0, Math.max(limit, 8));
    
    stats.trainCandidatesConsidered = trainTop.length;
    console.log(`[RecEngine] Evaluating top train candidates: ${trainTop.length}/${trainCandidates.length}`);

    for (const cand of trainTop) {
      const trainTransferTime = cand.transfer_time_sec;
      console.log(`[RecEngine] Train candidate ${cand.board.route_id ?? '-'} trip=${cand.board.trip_id ?? 'n/a'} transfer_time=${trainTransferTime} (${this.toIsoTime(trainTransferTime)})`);

      for (const busLine of allowedBusLines) {
        const variants = this.getVariantsForLine(busSegment, busLine);

        for (const { stopId, variant } of variants) {
          stats.variantChecks += 1;
          const walkTimeMin = this.resolveWalkTimeMinutes(config.walk_times, busLine, variant);
          const walkTimeSec = walkTimeMin * 60;

          const readySec = trainTransferTime + config.exit_buffer_sec + walkTimeSec;

          const busDeps = (busDataByStop[stopId] || [])
            .filter(d => d.route_id === busLine);

          // Find first bus after readySec
          const matchingBusDeps = busDeps.filter(d => {
            const busTime = d.live_sec ?? d.scheduled_sec;
            if (readySec > 80000 && busTime < 10000) return true; // crossed midnight handling
            return busTime >= readySec;
          });

          if (matchingBusDeps.length === 0) {
            stats.missingBusDepartures += 1;
            console.log(`[RecEngine] No bus match: line=${busLine}, variant=${variant ?? '-'}, stop=${stopId}, ready_sec=${readySec} (${this.toIsoTime(readySec)}), checked_departures=${busDeps.length}`);
            continue;
          }

          const busMatchesForVariant = matchingBusDeps.slice(0, 2);

          for (const busDep of busMatchesForVariant) {
            const busTime = busDep.live_sec ?? busDep.scheduled_sec;
            let bufferSec = busTime - readySec;
            if (readySec > 80000 && busTime < 10000) {
                bufferSec = (busTime + 86400) - readySec;
            }

            const warnings: string[] = [];
            warnings.push(...cand.warnings);
            if (!cand.board.live_sec) warnings.push('Brak danych live WKD – większe ryzyko');
            if (!busDep.live_sec) warnings.push(`Brak danych live ZTM dla linii ${busLine}`);

            let risk: "LOW" | "MED" | "HIGH";
            if (bufferSec < config.min_transfer_buffer_sec) {
              risk = "HIGH";
            } else if (bufferSec <= 300) {
              risk = "MED";
            } else {
              risk = "LOW";
            }
            if (!cand.board.live_sec && risk === "LOW") risk = "MED";
            stats.risk[risk] += 1;

            let score = bufferSec;
            if (!cand.board.live_sec) score -= 120;
            if (!busDep.live_sec) score -= 60;
            if (risk === "HIGH") score -= 300;
            if (risk === "MED") score -= 100;

            const optId = `${cand.board.scheduled_sec}_${busLine}_${variant ?? 'X'}_${busDep.scheduled_sec}`;

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
    }

    options.sort((a, b) => {
      const trainTimeCmp = (a.train.live_sec ?? a.train.scheduled_sec) - (b.train.live_sec ?? b.train.scheduled_sec);
      if (trainTimeCmp !== 0) return trainTimeCmp;

      const scoreCmp = b.score - a.score;
      if (scoreCmp !== 0) return scoreCmp;

      return (a.bus.live_sec ?? a.bus.scheduled_sec) - (b.bus.live_sec ?? b.bus.scheduled_sec);
    });

    console.log(`[RecEngine] Option diagnostics: variant_checks=${stats.variantChecks}, missing_bus_matches=${stats.missingBusDepartures}, risk_LOW=${stats.risk.LOW}, risk_MED=${stats.risk.MED}, risk_HIGH=${stats.risk.HIGH}`);

    const groupedByFirstRide = new Map<string, TransferOption[]>();
    for (const option of options) {
      const trainKey = `${option.train.route_id}:${option.train.stop_id}:${option.train.scheduled_sec}`;
      const curr = groupedByFirstRide.get(trainKey) ?? [];
      curr.push(option);
      groupedByFirstRide.set(trainKey, curr);
    }

    const selectedTrainGroups = [...groupedByFirstRide.values()]
      .sort((a, b) => (a[0].train.live_sec ?? a[0].train.scheduled_sec) - (b[0].train.live_sec ?? b[0].train.scheduled_sec))
      .slice(0, limit);

    return selectedTrainGroups.flatMap((group) =>
      group
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_TRANSFERS_PER_FIRST_RIDE)
    );
  }

  private absoluteTimeDiffSec(from: Departure, to: Departure): number {
    const fromEpoch = this.toEpochSec(from);
    const toEpoch = this.toEpochSec(to);
    return toEpoch - fromEpoch;
  }

  private toEpochSec(departure: Departure): number {
    const date = departure.date || this.todayDateYYYYMMDD();
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(4, 6));
    const day = Number(date.slice(6, 8));
    const sec = departure.live_sec ?? departure.scheduled_sec;
    const dayEpoch = Date.UTC(year, month - 1, day) / 1000;
    return dayEpoch + sec;
  }

  private todayDateYYYYMMDD(): string {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
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
    const hours = Math.floor(sec / 3600) % 24;
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.floor(sec % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private resolveWalkTimeMinutes(
    walkTimes: Record<string, number>,
    busLine: string,
    variant: string | null
  ): number {
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
    if (busSegment.from_stop_id) {
      return [{ stopId: busSegment.from_stop_id, variant: null }];
    }
    return [];
  }
}
