import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock3, MapPin, RefreshCw, Settings } from 'lucide-react';
import { api } from '../api';
import { Departure, RecommendationResult, RouteProfile, TransferOption, TripDetails, TripStop } from '../types';
import { formatBuffer, formatDelay, riskColor, riskLabel, secToHHMM } from '../utils/time';

const AUTO_REFRESH_INTERVAL = 25_000;
const PAST_WINDOW_SEC = 30 * 60;

interface Props {
  activeProfile: RouteProfile | null;
  onGoToSettings: () => void;
}

export function Dashboard({ activeProfile, onGoToSettings }: Props) {
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [allOptions, setAllOptions] = useState<TransferOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedDepartureKey, setSelectedDepartureKey] = useState<string | null>(null);
  const [tripDetails, setTripDetails] = useState<TripDetails | null>(null);
  const [tripLoading, setTripLoading] = useState(false);

  const fetchRecommendations = useCallback(async () => {
    if (!activeProfile) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api.getRecommendation(activeProfile.id, 16) as RecommendationResult;
      setResult(data);
      setAllOptions(data.options);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message ?? 'Nie udało się pobrać danych.');
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    fetchRecommendations();
    const interval = setInterval(fetchRecommendations, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchRecommendations]);

  const groupedDepartures = useMemo(() => {
    const groups = new Map<string, TransferOption[]>();

    for (const option of allOptions) {
      const key = getFirstRideKey(option);
      const current = groups.get(key) ?? [];
      current.push(option);
      groups.set(key, current);
    }

    const now = nowSecLocal();

    return [...groups.entries()]
      .map(([key, options]) => ({
        key,
        representative: chooseRepresentativeOption(options),
        options: sortTransfersByFeasibility(options),
      }))
      .filter((group) => departureSec(group.representative.train) >= now - PAST_WINDOW_SEC)
      .sort((a, b) => departureSec(a.representative.train) - departureSec(b.representative.train));
  }, [allOptions]);

  useEffect(() => {
    if (groupedDepartures.length === 0) {
      setSelectedDepartureKey(null);
      return;
    }

    if (!selectedDepartureKey || !groupedDepartures.some((g) => g.key === selectedDepartureKey)) {
      const now = nowSecLocal();
      const firstUpcoming = groupedDepartures.find((g) => departureSec(g.representative.train) >= now);
      setSelectedDepartureKey((firstUpcoming ?? groupedDepartures[0]).key);
    }
  }, [groupedDepartures, selectedDepartureKey]);

  const selectedDeparture = groupedDepartures.find((group) => group.key === selectedDepartureKey) ?? null;

  useEffect(() => {
    const tripId = selectedDeparture?.representative.train.trip_id;

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
  }, [selectedDeparture?.representative.train.trip_id]);

  if (!activeProfile) {
    return (
      <div style={styles.emptyState}>
        <p style={{ fontSize: 18, color: '#64748b' }}>Brak aktywnego profilu trasy.</p>
        <button style={styles.primaryBtn} onClick={onGoToSettings}>Skonfiguruj trasę</button>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h2 style={styles.pageTitle}>{activeProfile.name}</h2>
          <p style={styles.subtitle}>Najbliższe odjazdy + odjazdy sprzed maksymalnie 30 minut.</p>
        </div>
        <div style={styles.topActions}>
          {result && (
            <div style={styles.liveSources}>
              <span>{result.meta.live_status.wkd === 'available' ? '✅' : '❌'} WKD</span>
              <span>{result.meta.live_status.ztm === 'available' ? '✅' : '❌'} ZTM</span>
            </div>
          )}
          <button style={styles.iconBtn} onClick={fetchRecommendations} title="Odśwież" disabled={loading}>
            <RefreshCw size={16} />
          </button>
          <button style={styles.iconBtn} onClick={onGoToSettings} title="Ustawienia trasy">
            <Settings size={16} />
          </button>
        </div>
      </div>

      {lastRefresh && <p style={styles.refreshText}>Ostatnie odświeżenie: {lastRefresh.toLocaleTimeString('pl-PL')}</p>}
      {error && <div style={styles.errorBanner}><AlertTriangle size={14} /> {error}</div>}

      <div style={styles.layout}>
        <section style={styles.leftPane}>
          <h3 style={styles.sectionTitle}>Odjazdy z przystanku początkowego</h3>
          {groupedDepartures.length === 0 ? (
            <div style={styles.emptyCard}>Brak odjazdów w oknie czasowym.</div>
          ) : (
            groupedDepartures.map((group) => (
              <DepartureCard
                key={group.key}
                option={group.representative}
                selected={group.key === selectedDepartureKey}
                onClick={() => setSelectedDepartureKey(group.key)}
              />
            ))
          )}
        </section>

        <section style={styles.rightPane}>
          {selectedDeparture ? (
            <DepartureDetailsPanel
              representative={selectedDeparture.representative}
              options={selectedDeparture.options}
              tripDetails={tripDetails}
              tripLoading={tripLoading}
            />
          ) : (
            <div style={styles.emptyCard}>Wybierz odjazd, aby zobaczyć szczegóły trasy i przesiadek.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function DepartureCard({ option, selected, onClick }: { option: TransferOption; selected: boolean; onClick: () => void }) {
  const dep = departureSec(option.train);
  const diffMin = Math.round((dep - nowSecLocal()) / 60);
  const stateLabel = diffMin < 0 ? `${Math.abs(diffMin)} min temu` : `za ${diffMin} min`;

  return (
    <button
      onClick={onClick}
      style={{
        ...styles.departureCard,
        borderColor: selected ? '#2563eb' : '#dbe2ea',
        background: selected ? '#eff6ff' : 'white',
      }}
    >
      <div style={styles.rowBetween}>
        <strong>🚂 {secToHHMM(dep)}</strong>
        <span style={{ color: diffMin < 0 ? '#b45309' : '#166534', fontWeight: 700 }}>{stateLabel}</span>
      </div>
      <div style={styles.metaRow}>Kierunek: {option.train.headsign}</div>
      <div style={styles.metaRow}>Linia przesiadkowa (najlepsza): {option.bus.route_id} o {secToHHMM(departureSec(option.bus))}</div>
    </button>
  );
}

function DepartureDetailsPanel({
  representative,
  options,
  tripDetails,
  tripLoading,
}: {
  representative: TransferOption;
  options: TransferOption[];
  tripDetails: TripDetails | null;
  tripLoading: boolean;
}) {
  const currentPositionLabel = getCurrentVehiclePositionLabel(representative, tripDetails);

  return (
    <div style={styles.detailsPanel}>
      <h3 style={styles.sectionTitle}>Szczegóły odjazdu {secToHHMM(departureSec(representative.train))}</h3>

      <div style={styles.infoGrid}>
        <div style={styles.infoBox}>
          <Clock3 size={16} />
          <div>
            <div style={styles.infoLabel}>WKD</div>
            <strong>{representative.train.route_id} • {representative.train.headsign}</strong>
            <div style={styles.infoSub}>Odjazd: {secToHHMM(departureSec(representative.train))} {formatDelay(representative.train.delay_sec)}</div>
          </div>
        </div>

        <div style={styles.infoBox}>
          <Activity size={16} />
          <div>
            <div style={styles.infoLabel}>Pozycja pojazdu</div>
            <strong>{currentPositionLabel}</strong>
            <div style={styles.infoSub}>Aktualizowane na podstawie live/schedule.</div>
          </div>
        </div>
      </div>

      <div style={styles.subsection}>
        <h4 style={styles.subTitle}><MapPin size={14} /> Cała trasa kursu i rozkład</h4>
        {tripLoading && <p style={styles.muted}>Ładowanie pełnej trasy kursu…</p>}
        {!tripLoading && !tripDetails && <p style={styles.muted}>Brak szczegółów trasy dla tego kursu.</p>}
        {!tripLoading && tripDetails && (
          <div style={styles.stopsList}>
            {tripDetails.stops.map((stop) => (
              <StopRow key={`${stop.stop_id}-${stop.seq}`} stop={stop} />
            ))}
          </div>
        )}
      </div>

      <div style={styles.subsection}>
        <h4 style={styles.subTitle}>Przesiadki (od najszybszej możliwej)</h4>
        <div style={styles.transferList}>
          {options.map((option) => {
            const risk = riskColor(option.risk);
            return (
              <div key={option.id} style={{ ...styles.transferRow, borderLeftColor: risk }}>
                <div style={styles.rowBetween}>
                  <strong>🚌 {option.bus.route_id} • {secToHHMM(departureSec(option.bus))}</strong>
                  <span style={{ color: risk, fontWeight: 700 }}>{riskLabel(option.risk)}</span>
                </div>
                <div style={styles.metaRow}>Kierunek: {option.bus.headsign}</div>
                <div style={styles.metaRow}>Bufor: {formatBuffer(option.buffer_sec)} • Dojście: {Math.round(option.walk_sec / 60)} min</div>
                <div style={styles.metaRow}>Live: {formatDelay(option.bus.delay_sec)} {option.bus.live_sec ? '(tracking aktywny)' : '(brak live)'} </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StopRow({ stop }: { stop: TripStop }) {
  return (
    <div style={styles.stopRow}>
      <div>
        <strong>{stop.seq}. {stop.stop_name}</strong>
      </div>
      <div style={styles.stopTimes}>
        <span>Plan: {secToHHMM(stop.scheduled_sec)}</span>
        <span>Live: {secToHHMM(stop.estimated_live_sec ?? stop.scheduled_sec)} {formatDelay(stop.delay_sec)}</span>
      </div>
    </div>
  );
}

function getCurrentVehiclePositionLabel(option: TransferOption, tripDetails: TripDetails | null): string {
  const now = nowSecLocal();

  if (tripDetails && tripDetails.stops.length > 1) {
    const sortedStops = [...tripDetails.stops].sort((a, b) => a.seq - b.seq);
    const nextStop = sortedStops.find((stop) => (stop.estimated_live_sec ?? stop.scheduled_sec) >= now);

    if (!nextStop) return 'Kurs powinien być już po ostatnim przystanku.';
    if (nextStop.seq === sortedStops[0].seq) return `Przed odjazdem z: ${nextStop.stop_name}`;

    const prevStop = sortedStops.find((stop) => stop.seq === nextStop.seq - 1);
    if (!prevStop) return `Zbliża się do: ${nextStop.stop_name}`;

    return `Między: ${prevStop.stop_name} → ${nextStop.stop_name}`;
  }

  const trainDeparture = departureSec(option.train);
  const transferArrival = getTransferStationArrivalTime(option);

  if (now < trainDeparture) return 'Na przystanku początkowym (przed odjazdem).';
  if (now < transferArrival) return 'W trasie do punktu przesiadki.';

  return 'Po dojechaniu do punktu przesiadki.';
}

function departureSec(departure: Departure): number {
  return departure.live_sec ?? departure.scheduled_sec;
}

function getTransferStationArrivalTime(option: TransferOption): number {
  if (option.train_transfer) return departureSec(option.train_transfer);
  if (option.train_transfer_time_sec) return option.train_transfer_time_sec;
  return option.ready_sec - option.walk_sec - option.exit_buffer_sec;
}

function getFirstRideKey(option: TransferOption): string {
  return `${option.train.route_id}:${option.train.stop_id}:${option.train.scheduled_sec}`;
}

function chooseRepresentativeOption(options: TransferOption[]): TransferOption {
  return sortTransfersByFeasibility(options)[0];
}

function sortTransfersByFeasibility(options: TransferOption[]): TransferOption[] {
  return [...options].sort((a, b) => {
    const aReady = a.ready_sec;
    const bReady = b.ready_sec;

    if (aReady !== bReady) return aReady - bReady;

    const aBus = departureSec(a.bus);
    const bBus = departureSec(b.bus);

    if (aBus !== bBus) return aBus - bBus;

    return b.buffer_sec - a.buffer_sec;
  });
}

function nowSecLocal(): number {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

const styles: Record<string, React.CSSProperties> = {
  page: { paddingBottom: 32 },
  topBar: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 8 },
  pageTitle: { margin: 0, fontSize: 28, color: '#0f172a' },
  subtitle: { margin: '6px 0 0', color: '#475569' },
  topActions: { display: 'flex', gap: 8, alignItems: 'center' },
  liveSources: { display: 'flex', gap: 8, fontSize: 13, color: '#334155' },
  iconBtn: { border: '1px solid #cbd5e1', borderRadius: 8, background: 'white', padding: 8, cursor: 'pointer', display: 'flex' },
  refreshText: { margin: '0 0 12px', color: '#64748b', fontSize: 13 },
  errorBanner: { display: 'flex', gap: 8, alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', marginBottom: 12 },
  layout: { display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' },
  leftPane: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, position: 'sticky', top: 84 },
  rightPane: { minHeight: 300 },
  sectionTitle: { margin: 0, fontSize: 18, color: '#0f172a' },
  departureCard: { width: '100%', textAlign: 'left', border: '1px solid', borderRadius: 10, padding: 12, marginTop: 10, cursor: 'pointer' },
  rowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  metaRow: { color: '#475569', marginTop: 6, fontSize: 14 },
  detailsPanel: { background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 },
  infoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 },
  infoBox: { display: 'flex', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, alignItems: 'flex-start' },
  infoLabel: { fontSize: 12, color: '#64748b', marginBottom: 3 },
  infoSub: { color: '#475569', marginTop: 4, fontSize: 13 },
  subsection: { marginTop: 18 },
  subTitle: { margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' },
  muted: { color: '#64748b', margin: 0 },
  stopsList: { display: 'grid', gap: 8, maxHeight: 340, overflowY: 'auto', paddingRight: 4 },
  stopRow: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', gap: 10 },
  stopTimes: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', color: '#334155', fontSize: 13 },
  transferList: { display: 'grid', gap: 8 },
  transferRow: { border: '1px solid #e2e8f0', borderLeft: '4px solid', borderRadius: 8, padding: 10 },
  emptyCard: { background: 'white', border: '1px dashed #cbd5e1', borderRadius: 10, padding: 16, color: '#64748b', marginTop: 10 },
  emptyState: { textAlign: 'center', padding: '52px 0', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' },
  primaryBtn: { background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontWeight: 600 },
};
