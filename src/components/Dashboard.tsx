import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, LocateFixed, MapPin, RefreshCw, Settings } from 'lucide-react';
import { api } from '../api';
import { Departure, RecommendationResult, RouteProfile, TransferOption, TripDetails } from '../types';
import { formatBuffer, formatDelay, riskColor, riskLabel, secToHHMM } from '../utils/time';

const AUTO_REFRESH_INTERVAL = 25_000;
const RECENT_DEPARTURES_WINDOW_SEC = 30 * 60;

interface Props {
  activeProfile: RouteProfile | null;
  onGoToSettings: () => void;
}

export function Dashboard({ activeProfile, onGoToSettings }: Props) {
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [allOptions, setAllOptions] = useState<TransferOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [tripDetails, setTripDetails] = useState<TripDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [tripLoading, setTripLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchRecommendations = useCallback(async () => {
    if (!activeProfile) return;
    setLoading(true);
    setError(null);
    try {
      const data = (await api.getRecommendation(activeProfile.id, 10)) as RecommendationResult;
      const dashboardOptions = getDashboardOptions(data.options);
      setAllOptions(data.options);
      setResult({ ...data, options: dashboardOptions });
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message || 'Nie udało się pobrać rekomendacji.');
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    fetchRecommendations();
    const interval = setInterval(fetchRecommendations, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchRecommendations]);

  const visibleOptions = useMemo(() => {
    const now = nowSecLocal();
    return (result?.options ?? [])
      .filter((option) => departureSec(option.train) >= now - RECENT_DEPARTURES_WINDOW_SEC)
      .sort((a, b) => departureSec(a.train) - departureSec(b.train));
  }, [result]);

  useEffect(() => {
    if (visibleOptions.length === 0) {
      setSelectedOptionId(null);
      return;
    }
    const selectedStillVisible = visibleOptions.some((opt) => opt.id === selectedOptionId);
    if (selectedStillVisible) return;

    const now = nowSecLocal();
    const nearestFuture = visibleOptions.find((opt) => departureSec(opt.train) >= now);
    setSelectedOptionId((nearestFuture ?? visibleOptions[visibleOptions.length - 1]).id);
  }, [visibleOptions, selectedOptionId]);

  const selectedOption = visibleOptions.find((option) => option.id === selectedOptionId) ?? null;

  const transferChoices = useMemo(() => {
    if (!selectedOption) return [];
    return sortTransfersForLive(
      allOptions.filter((option) => getFirstRideKey(option) === getFirstRideKey(selectedOption))
    );
  }, [allOptions, selectedOption]);

  useEffect(() => {
    const tripId = selectedOption?.train.trip_id ?? null;
    if (!tripId) {
      setTripDetails(null);
      setTripLoading(false);
      return;
    }

    let cancelled = false;
    setTripLoading(true);
    api.getTripDetails(tripId)
      .then((data) => {
        if (!cancelled) setTripDetails(data.trip ?? null);
      })
      .catch(() => {
        if (!cancelled) setTripDetails(null);
      })
      .finally(() => {
        if (!cancelled) setTripLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOption?.train.trip_id]);

  if (!activeProfile) {
    return (
      <div style={styles.emptyState}>
        <h2>Brak aktywnej trasy</h2>
        <p>Ustaw profil, aby zobaczyć odjazdy i monitoring przesiadek.</p>
        <button style={styles.primaryButton} onClick={onGoToSettings}>Konfiguruj trasę</button>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 style={styles.pageTitle}>{activeProfile.name}</h2>
          <p style={styles.subtitle}>Najbliższe odjazdy + odjazdy z ostatnich 30 minut</p>
          {lastRefresh && <p style={styles.refreshInfo}>Aktualizacja: {lastRefresh.toLocaleTimeString('pl-PL')}</p>}
        </div>
        <div style={styles.headerActions}>
          {result && (
            <div style={styles.statusPills}>
              <span style={styles.statusPill}>WKD: {result.meta.live_status.wkd === 'available' ? 'live' : 'offline'}</span>
              <span style={styles.statusPill}>ZTM: {result.meta.live_status.ztm === 'available' ? 'live' : 'offline'}</span>
            </div>
          )}
          <button style={styles.iconButton} onClick={fetchRecommendations} title="Odśwież" disabled={loading}>
            <RefreshCw size={18} />
          </button>
          <button style={styles.iconButton} onClick={onGoToSettings} title="Ustawienia">
            <Settings size={18} />
          </button>
        </div>
      </div>

      {error && <div style={styles.error}><AlertTriangle size={16} />{error}</div>}

      <div style={styles.grid}>
        <section style={styles.departureListSection}>
          <h3 style={styles.sectionTitle}>Odjazdy z przystanku początkowego</h3>
          {visibleOptions.length === 0 && !loading && <p style={styles.muted}>Brak odjazdów w aktywnym oknie czasowym.</p>}
          <div style={styles.departureList}>
            {visibleOptions.map((option) => (
              <DepartureCard
                key={option.id}
                option={option}
                selected={option.id === selectedOption?.id}
                onClick={() => setSelectedOptionId(option.id)}
              />
            ))}
          </div>
        </section>

        <section style={styles.detailSection}>
          {!selectedOption ? (
            <p style={styles.muted}>Wybierz odjazd, aby zobaczyć szczegóły trasy i przesiadek.</p>
          ) : (
            <DepartureDetails option={selectedOption} transferChoices={transferChoices} tripDetails={tripDetails} tripLoading={tripLoading} />
          )}
        </section>
      </div>
    </div>
  );
}

function DepartureCard({ option, selected, onClick }: { option: TransferOption; selected: boolean; onClick: () => void; }) {
  const now = nowSecLocal();
  const trainDeparture = departureSec(option.train);
  const trainStatus = trainDeparture >= now ? 'Nadchodzi' : 'Odbył się';
  const trainStatusColor = trainDeparture >= now ? '#0369a1' : '#6b7280';

  return (
    <button style={{ ...styles.departureCard, ...(selected ? styles.departureCardSelected : {}) }} onClick={onClick}>
      <div style={styles.departureTopRow}>
        <strong>🚆 {secToHHMM(trainDeparture)}</strong>
        <span style={{ ...styles.tag, color: trainStatusColor, borderColor: trainStatusColor }}>{trainStatus}</span>
      </div>
      <div style={styles.departureMeta}>WKD {option.train.route_id} → {option.train.headsign}</div>
      <div style={styles.departureMeta}>Przesiadka: 🚌 {option.bus.route_id} {secToHHMM(departureSec(option.bus))}</div>
      <div style={styles.departureBottom}>
        <span style={{ color: riskColor(option.risk), fontWeight: 700 }}>{riskLabel(option.risk)}</span>
        <span>Bufor: {formatBuffer(option.buffer_sec)}</span>
      </div>
    </button>
  );
}

function DepartureDetails({ option, transferChoices, tripDetails, tripLoading }: {
  option: TransferOption;
  transferChoices: TransferOption[];
  tripDetails: TripDetails | null;
  tripLoading: boolean;
}) {
  const now = nowSecLocal();
  const transferArrivalSec = getTransferStationArrivalTime(option);
  const currentPosition = describeCurrentPosition(now, option, tripDetails);

  return (
    <div style={styles.detailsContainer}>
      <h3 style={styles.sectionTitle}>Szczegóły odjazdu</h3>
      <div style={styles.timeline}>
        <div style={styles.timelineItem}><Clock3 size={16} /> Odjazd WKD: <strong>{secToHHMM(departureSec(option.train))}</strong> {formatDelay(option.train.delay_sec)}</div>
        <div style={styles.timelineItem}><MapPin size={16} /> Stacja przesiadki: <strong>{secToHHMM(transferArrivalSec)}</strong></div>
        <div style={styles.timelineItem}><LocateFixed size={16} /> Aktualna pozycja: <strong>{currentPosition}</strong></div>
        <div style={styles.timelineItem}>🚶 Dojście pieszo: <strong>{Math.floor(option.walk_sec / 60)} min</strong></div>
        <div style={styles.timelineItem}>🚌 Odjazd autobusu: <strong>{secToHHMM(departureSec(option.bus))}</strong> {formatDelay(option.bus.delay_sec)}</div>
      </div>

      <h4 style={styles.subTitle}>Możliwości przesiadki (od najszybszej)</h4>
      <div style={styles.transferList}>
        {transferChoices.map((alt) => (
          <div key={alt.id} style={styles.transferRow}>
            <span>{secToHHMM(departureSec(alt.bus))} • linia {alt.bus.route_id}</span>
            <span>{formatBuffer(alt.buffer_sec)} • {riskLabel(alt.risk)}</span>
            <span style={styles.liveStatusText}>Live: {formatDelay(alt.bus.delay_sec)}</span>
          </div>
        ))}
      </div>

      <h4 style={styles.subTitle}>Pełna trasa i rozkład</h4>
      {tripLoading && <p style={styles.muted}>Ładowanie przebiegu pojazdu…</p>}
      {!tripLoading && !tripDetails && <p style={styles.muted}>Brak szczegółowej geometrii kursu dla tego pojazdu.</p>}
      {!tripLoading && tripDetails && (
        <div style={styles.stopsList}>
          {tripDetails.stops.map((stop) => (
            <div key={`${stop.stop_id}-${stop.seq}`} style={styles.stopRow}>
              <span>{stop.seq}. {stop.stop_name}</span>
              <span>{secToHHMM(stop.estimated_live_sec ?? stop.scheduled_sec)} {formatDelay(stop.delay_sec)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function departureSec(departure: Departure): number {
  return departure.live_sec ?? departure.scheduled_sec;
}

function getFirstRideKey(option: TransferOption): string {
  return `${option.train.route_id}:${option.train.stop_id}:${option.train.scheduled_sec}`;
}

function getOptionDedupeKey(option: TransferOption): string {
  return `${getFirstRideKey(option)}:${option.bus.route_id}:${option.bus.scheduled_sec}:${option.bus_stop_variant ?? ''}`;
}

function riskScore(risk: TransferOption['risk']): number {
  if (risk === 'LOW') return 0;
  if (risk === 'MED') return 1;
  return 2;
}

function chooseBestTransferForFirstRide(options: TransferOption[]): TransferOption {
  return [...options].sort((a, b) => {
    const busCmp = departureSec(a.bus) - departureSec(b.bus);
    if (busCmp !== 0) return busCmp;

    const riskCmp = riskScore(a.risk) - riskScore(b.risk);
    if (riskCmp !== 0) return riskCmp;

    return b.buffer_sec - a.buffer_sec;
  })[0];
}

function getDashboardOptions(options: TransferOption[]): TransferOption[] {
  const dedupedByTrainBus = new Map<string, TransferOption[]>();
  for (const option of options) {
    const key = getOptionDedupeKey(option);
    const curr = dedupedByTrainBus.get(key) ?? [];
    curr.push(option);
    dedupedByTrainBus.set(key, curr);
  }

  const uniqueOptions = [...dedupedByTrainBus.values()].map((group) => chooseBestTransferForFirstRide(group));

  const groupedByFirstRide = new Map<string, TransferOption[]>();
  for (const option of uniqueOptions) {
    const key = getFirstRideKey(option);
    const curr = groupedByFirstRide.get(key) ?? [];
    curr.push(option);
    groupedByFirstRide.set(key, curr);
  }

  return [...groupedByFirstRide.values()]
    .map((group) => chooseBestTransferForFirstRide(group))
    .sort((a, b) => departureSec(a.train) - departureSec(b.train));
}

function sortTransfersForLive(options: TransferOption[]): TransferOption[] {
  return [...options].sort((a, b) => {
    const arrivalCmp = getTransferStationArrivalTime(a) - getTransferStationArrivalTime(b);
    if (arrivalCmp !== 0) return arrivalCmp;

    const busCmp = departureSec(a.bus) - departureSec(b.bus);
    if (busCmp !== 0) return busCmp;

    return riskScore(a.risk) - riskScore(b.risk);
  });
}

function getTransferStationArrivalTime(option: TransferOption): number {
  if (option.train_transfer) return option.train_transfer.live_sec ?? option.train_transfer.scheduled_sec;
  if (option.train_transfer_time_sec) return option.train_transfer_time_sec;
  return option.ready_sec - option.walk_sec - option.exit_buffer_sec;
}

function nowSecLocal(): number {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function describeCurrentPosition(nowSec: number, option: TransferOption, details: TripDetails | null): string {
  const trainDepartureSec = departureSec(option.train);
  const transferArrivalSec = getTransferStationArrivalTime(option);
  const busDepartureSec = departureSec(option.bus);

  if (!details) {
    if (nowSec < trainDepartureSec) return 'przed odjazdem (stacja początkowa)';
    if (nowSec < transferArrivalSec) return 'WKD w trasie do przesiadki';
    if (nowSec < busDepartureSec) return 'przesiadka / przejście pieszo';
    return 'autobus po przesiadce w trasie';
  }

  const nextStop = details.stops.find((stop) => (stop.estimated_live_sec ?? stop.scheduled_sec) >= nowSec);
  if (!nextStop) return 'końcowy odcinek trasy';
  return `okolice przystanku ${nextStop.stop_name}`;
}

const styles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  pageHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16,
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16,
  },
  pageTitle: { margin: 0, fontSize: 26 },
  subtitle: { margin: '6px 0', color: '#475569' },
  refreshInfo: { margin: 0, color: '#64748b', fontSize: 13 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  statusPills: { display: 'flex', gap: 6 },
  statusPill: { border: '1px solid #cbd5e1', borderRadius: 999, padding: '4px 8px', fontSize: 12 },
  iconButton: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36,
    borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer',
  },
  error: {
    display: 'flex', alignItems: 'center', gap: 8, color: '#b91c1c', background: '#fee2e2',
    border: '1px solid #fecaca', borderRadius: 10, padding: 10,
  },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 16 },
  departureListSection: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 12 },
  detailSection: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16 },
  sectionTitle: { marginTop: 0, marginBottom: 12 },
  departureList: { display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '72vh', overflowY: 'auto' },
  departureCard: {
    textAlign: 'left', borderRadius: 12, border: '1px solid #e2e8f0', padding: 12, background: '#fff',
    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
  },
  departureCardSelected: { borderColor: '#0f766e', boxShadow: '0 0 0 2px rgba(15,118,110,.15)' },
  departureTopRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  departureMeta: { color: '#475569', fontSize: 14 },
  departureBottom: { display: 'flex', justifyContent: 'space-between', fontSize: 14 },
  tag: { border: '1px solid', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 600 },
  detailsContainer: { display: 'flex', flexDirection: 'column', gap: 10 },
  timeline: { display: 'flex', flexDirection: 'column', gap: 8, background: '#f8fafc', padding: 12, borderRadius: 10 },
  timelineItem: { display: 'flex', gap: 8, alignItems: 'center', color: '#1e293b' },
  subTitle: { marginBottom: 4, marginTop: 8 },
  transferList: { display: 'flex', flexDirection: 'column', gap: 8 },
  transferRow: {
    display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center',
    border: '1px solid #e2e8f0', borderRadius: 10, padding: 8, fontSize: 14,
  },
  liveStatusText: { color: '#0f766e', fontWeight: 600 },
  stopsList: { maxHeight: 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 },
  stopRow: {
    display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 10px',
    borderBottom: '1px solid #f1f5f9', fontSize: 14,
  },
  emptyState: {
    display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', padding: 24,
    borderRadius: 14, border: '1px dashed #94a3b8', background: '#fff',
  },
  muted: { color: '#64748b' },
  primaryButton: {
    background: '#0f766e', color: 'white', border: 'none', borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
  },
};
