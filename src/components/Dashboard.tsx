import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock3, MapPin, RefreshCw, Settings } from 'lucide-react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';
import { api } from '../api';
import { Departure, RecommendationResult, RouteProfile, TransferOption, TripDetails, TripStop } from '../types';
import { formatBuffer, formatDelay, riskColor, riskLabel, secToHHMM } from '../utils/time';

const AUTO_REFRESH_INTERVAL = 25_000;
const PAST_WINDOW_SEC = 30 * 60;
const DEFAULT_MAP_CENTER: [number, number] = [52.2297, 21.0122];

interface Props {
  activeProfile: RouteProfile | null;
  onGoToSettings: () => void;
}

export function Dashboard({ activeProfile, onGoToSettings }: Props) {
  const isMobile = useIsMobile();
  const pageVisible = usePageVisible();
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [allOptions, setAllOptions] = useState<TransferOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedDepartureKey, setSelectedDepartureKey] = useState<string | null>(null);
  const [tripDetails, setTripDetails] = useState<TripDetails | null>(null);
  const [tripLoading, setTripLoading] = useState(false);
  const [busTripsById, setBusTripsById] = useState<Record<string, TripDetails | null>>({});

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
    if (!pageVisible) return;

    fetchRecommendations();
    const interval = setInterval(fetchRecommendations, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchRecommendations, pageVisible]);

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
    if (!pageVisible) return;

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
  }, [selectedDeparture?.representative.train.trip_id, pageVisible]);

  useEffect(() => {
    const busTripIds = Array.from(
      new Set((selectedDeparture?.options ?? []).map((option) => option.bus.trip_id).filter((id): id is string => Boolean(id))),
    );

    if (!pageVisible || busTripIds.length === 0) {
      setBusTripsById({});
      return;
    }

    const missingTripIds = busTripIds.filter((tripId) => !(tripId in busTripsById));
    if (missingTripIds.length === 0) return;

    let cancelled = false;

    Promise.all(
      missingTripIds.map(async (tripId) => {
        try {
          const data = await api.getTripDetails(tripId);
          return [tripId, data.trip ?? null] as const;
        } catch {
          return [tripId, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setBusTripsById((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });

    return () => {
      cancelled = true;
    };
  }, [selectedDeparture, busTripsById, pageVisible]);

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
      <div style={{ ...styles.topBar, ...(isMobile ? styles.topBarMobile : {}) }}>
        <div>
          <h2 style={{ ...styles.pageTitle, ...(isMobile ? styles.pageTitleMobile : {}) }}>{activeProfile.name}</h2>
          <p style={{ ...styles.subtitle, ...(isMobile ? styles.subtitleMobile : {}) }}>Najbliższe odjazdy + odjazdy sprzed maksymalnie 30 minut.</p>
        </div>
        <div style={{ ...styles.topActions, ...(isMobile ? styles.topActionsMobile : {}) }}>
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

      <div style={{ ...styles.layout, ...(isMobile ? styles.layoutMobile : {}) }}>
        <section style={{ ...styles.leftPane, ...(isMobile ? styles.leftPaneMobile : {}) }}>
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

        <section style={{ ...styles.rightPane, ...(isMobile ? styles.rightPaneMobile : {}) }}>
          {selectedDeparture ? (
            <DepartureDetailsPanel
              representative={selectedDeparture.representative}
              options={selectedDeparture.options}
              tripDetails={tripDetails}
              tripLoading={tripLoading}
              busTripsById={busTripsById}
            />
          ) : (
            <div style={styles.emptyCard}>Wybierz odjazd, aby zobaczyć szczegóły trasy i przesiadek.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function usePageVisible() {
  const [visible, setVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onVisibilityChange = () => {
      setVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return visible;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 900px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setIsMobile(media.matches);
    update();

    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
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
  busTripsById,
}: {
  representative: TransferOption;
  options: TransferOption[];
  tripDetails: TripDetails | null;
  tripLoading: boolean;
  busTripsById: Record<string, TripDetails | null>;
}) {
  const currentPositionLabel = getCurrentVehiclePositionLabel(representative, tripDetails);
  const transferStopId = representative.train_transfer?.stop_id;
  const trainStopsToTransfer = getStopsUntilTransfer(tripDetails, transferStopId);

  const mapData = buildMapData(representative, tripDetails, options, busTripsById);

  return (
    <div style={styles.detailsPanel}>
      <h3 style={styles.sectionTitle}>Szczegóły odjazdu {secToHHMM(departureSec(representative.train))}</h3>

      <div style={styles.infoGrid}>
        <div style={styles.infoBox}>
          <Clock3 size={16} />
          <div>
            <div style={styles.infoLabel}>WKD</div>
            <strong>{representative.train.route_id} • {representative.train.headsign}</strong>
            <div style={styles.infoSub}>Odjazd: {formatPlannedWithDelay(representative.train.scheduled_sec, representative.train.delay_sec)}</div>
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
        <h4 style={styles.subTitle}><MapPin size={14} /> Mapa pojazdów (OpenStreetMap)</h4>
        <VehicleMap mapData={mapData} />
      </div>

      <div style={styles.subsection}>
        <h4 style={styles.subTitle}><MapPin size={14} /> Rozkład WKD do planowanej przesiadki</h4>
        {tripLoading && <p style={styles.muted}>Ładowanie trasy WKD…</p>}
        {!tripLoading && !tripDetails && <p style={styles.muted}>Brak szczegółów trasy dla tego kursu.</p>}
        {!tripLoading && tripDetails && (
          <div style={styles.stopsList}>
            {trainStopsToTransfer.map((stop) => (
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
            const busTrip = option.bus.trip_id ? busTripsById[option.bus.trip_id] : null;
            const boardingStop = busTrip ? busTrip.stops.find((stop) => stop.stop_id === option.bus.stop_id) : null;
            const busStopsFromBoarding = busTrip ? getStopsFromBoarding(busTrip, option.bus.stop_id) : [];

            return (
              <div key={option.id} style={{ ...styles.transferRow, borderLeftColor: risk }}>
                <div style={styles.rowBetween}>
                  <strong>🚌 {option.bus.route_id} • {secToHHMM(departureSec(option.bus))}</strong>
                  <span style={{ color: risk, fontWeight: 700 }}>{riskLabel(option.risk)}</span>
                </div>
                <div style={styles.metaRow}>Kierunek: {option.bus.headsign}</div>
                <div style={styles.metaRow}>Bufor: {formatBuffer(option.buffer_sec)} • Dojście: {Math.round(option.walk_sec / 60)} min</div>
                <div style={styles.metaRow}>Odjazd (plan + opóźnienie): {formatPlannedWithDelay(option.bus.scheduled_sec, option.bus.delay_sec)}</div>
                <div style={styles.metaRow}>Przystanek planowanego odjazdu na przesiadce: {boardingStop?.stop_name ?? option.bus.stop_id}</div>
                {busStopsFromBoarding.length > 0 && (
                  <div style={styles.innerStopsList}>
                    {busStopsFromBoarding.map((stop) => (
                      <StopRow key={`${option.id}-${stop.stop_id}-${stop.seq}`} stop={stop} compact />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VehicleMap({ mapData }: { mapData: MapData }) {
  return (
    <div style={styles.mapWrap}>
      <MapContainer center={mapData.center} zoom={12} style={styles.mapCanvas} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {mapData.trainPath.length > 1 && <Polyline positions={mapData.trainPath} pathOptions={{ color: '#2563eb', weight: 4 }} />}
        {mapData.transferPaths.map((path) => (
          <Polyline key={path.id} positions={path.points} pathOptions={{ color: '#16a34a', weight: 3, dashArray: '6 6' }} />
        ))}

        {mapData.markers.map((marker) => (
          <CircleMarker key={marker.id} center={marker.position} radius={7} pathOptions={{ color: marker.color, fillColor: marker.color, fillOpacity: 0.8 }}>
            <Popup>{marker.label}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

function StopRow({ stop, compact = false }: { stop: TripStop; compact?: boolean }) {
  return (
    <div style={{ ...styles.stopRow, padding: compact ? 8 : 10 }}>
      <div>
        <strong>{stop.seq}. {stop.stop_name}</strong>
      </div>
      <div style={styles.stopTimes}>
        <span>{formatPlannedWithDelay(stop.scheduled_sec, stop.delay_sec)}</span>
      </div>
    </div>
  );
}

function formatPlannedWithDelay(scheduledSec: number, delaySec: number | null): string {
  const delay = formatDelay(delaySec);
  if (!delay || delay === 'na czas') return `${secToHHMM(scheduledSec)} (plan)`;
  return `${secToHHMM(scheduledSec)} (${delay})`;
}

function getStopsUntilTransfer(tripDetails: TripDetails | null, transferStopId?: string): TripStop[] {
  if (!tripDetails) return [];
  if (!transferStopId) return tripDetails.stops;

  const transferStop = tripDetails.stops.find((stop) => stop.stop_id === transferStopId);
  if (!transferStop) return tripDetails.stops;

  return tripDetails.stops.filter((stop) => stop.seq <= transferStop.seq);
}

function getStopsFromBoarding(tripDetails: TripDetails, boardingStopId: string): TripStop[] {
  const sorted = [...tripDetails.stops].sort((a, b) => a.seq - b.seq);
  const boarding = sorted.find((stop) => stop.stop_id === boardingStopId);
  if (!boarding) return sorted;
  return sorted.filter((stop) => stop.seq >= boarding.seq);
}

interface MapData {
  center: [number, number];
  trainPath: [number, number][];
  transferPaths: Array<{ id: string; points: [number, number][] }>;
  markers: Array<{ id: string; position: [number, number]; label: string; color: string }>;
}

function buildMapData(
  representative: TransferOption,
  trainTrip: TripDetails | null,
  options: TransferOption[],
  busTripsById: Record<string, TripDetails | null>,
): MapData {
  const markers: MapData['markers'] = [];
  const trainPath = tripShapeToLatLng(trainTrip);
  const trainPosition = trainTrip ? computeVehiclePosition(trainTrip) : null;

  if (trainPosition) {
    markers.push({
      id: 'train-pos',
      position: trainPosition,
      label: `WKD ${representative.train.route_id} • ${representative.train.headsign}`,
      color: '#2563eb',
    });
  }

  const transferPaths: MapData['transferPaths'] = [];
  options.forEach((option) => {
    if (!option.bus.trip_id) return;
    const busTrip = busTripsById[option.bus.trip_id];
    if (!busTrip) return;

    const path = tripShapeToLatLng(busTrip);
    if (path.length > 1) {
      transferPaths.push({ id: option.id, points: path });
    }

    const busPosition = computeVehiclePosition(busTrip);
    if (busPosition) {
      markers.push({
        id: `bus-pos-${option.id}`,
        position: busPosition,
        label: `Przesiadka: ${option.bus.route_id} • ${option.bus.headsign}`,
        color: '#16a34a',
      });
    }
  });

  const allPoints = [...trainPath, ...transferPaths.flatMap((path) => path.points), ...markers.map((m) => m.position)];
  const center = allPoints[0] ?? DEFAULT_MAP_CENTER;

  return { center, trainPath, transferPaths, markers };
}

function computeVehiclePosition(trip: TripDetails): [number, number] | null {
  const sortedStops = [...trip.stops].sort((a, b) => a.seq - b.seq);
  if (sortedStops.length === 0) return null;

  const now = nowSecLocal();
  const nextStop = sortedStops.find((stop) => (stop.estimated_live_sec ?? stop.scheduled_sec) >= now);

  if (!nextStop) {
    const last = sortedStops[sortedStops.length - 1];
    return [last.lat, last.lon];
  }

  if (nextStop.seq === sortedStops[0].seq) {
    return [nextStop.lat, nextStop.lon];
  }

  const prevStop = sortedStops.find((stop) => stop.seq === nextStop.seq - 1);
  if (!prevStop) return [nextStop.lat, nextStop.lon];

  const prevT = prevStop.estimated_live_sec ?? prevStop.scheduled_sec;
  const nextT = nextStop.estimated_live_sec ?? nextStop.scheduled_sec;
  const progress = nextT > prevT ? Math.min(1, Math.max(0, (now - prevT) / (nextT - prevT))) : 0;

  const lat = prevStop.lat + (nextStop.lat - prevStop.lat) * progress;
  const lon = prevStop.lon + (nextStop.lon - prevStop.lon) * progress;
  return [lat, lon];
}

function tripShapeToLatLng(trip: TripDetails | null): [number, number][] {
  if (!trip) return [];
  if (trip.shape.coordinates.length > 0) {
    return trip.shape.coordinates.map(([lon, lat]) => [lat, lon]);
  }

  return [...trip.stops]
    .sort((a, b) => a.seq - b.seq)
    .map((stop) => [stop.lat, stop.lon]);
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
  topBarMobile: { flexDirection: 'column' },
  pageTitle: { margin: 0, fontSize: 28, color: '#0f172a' },
  pageTitleMobile: { fontSize: 22 },
  subtitle: { margin: '6px 0 0', color: '#475569' },
  subtitleMobile: { fontSize: 14 },
  topActions: { display: 'flex', gap: 8, alignItems: 'center' },
  topActionsMobile: { width: '100%', justifyContent: 'space-between' },
  liveSources: { display: 'flex', gap: 8, fontSize: 13, color: '#334155' },
  iconBtn: { border: '1px solid #cbd5e1', borderRadius: 8, background: 'white', padding: 8, cursor: 'pointer', display: 'flex' },
  refreshText: { margin: '0 0 12px', color: '#64748b', fontSize: 13 },
  errorBanner: { display: 'flex', gap: 8, alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', marginBottom: 12 },
  layout: { display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' },
  layoutMobile: { gridTemplateColumns: '1fr' },
  leftPane: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, position: 'sticky', top: 84 },
  leftPaneMobile: { position: 'static', top: 'auto' },
  rightPane: { minHeight: 300 },
  rightPaneMobile: { minHeight: 0 },
  sectionTitle: { margin: 0, fontSize: 18, color: '#0f172a' },
  departureCard: { width: '100%', textAlign: 'left', border: '1px solid', borderRadius: 10, padding: 12, marginTop: 10, cursor: 'pointer' },
  rowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  metaRow: { color: '#475569', marginTop: 6, fontSize: 14 },
  detailsPanel: { background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 },
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 },
  infoBox: { display: 'flex', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, alignItems: 'flex-start' },
  infoLabel: { fontSize: 12, color: '#64748b', marginBottom: 3 },
  infoSub: { color: '#475569', marginTop: 4, fontSize: 13 },
  subsection: { marginTop: 18 },
  subTitle: { margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' },
  muted: { color: '#64748b', margin: 0 },
  stopsList: { display: 'grid', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 4 },
  innerStopsList: { display: 'grid', gap: 6, marginTop: 8, maxHeight: 220, overflowY: 'auto' },
  stopRow: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', gap: 10 },
  stopTimes: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', color: '#334155', fontSize: 13 },
  transferList: { display: 'grid', gap: 8 },
  transferRow: { border: '1px solid #e2e8f0', borderLeft: '4px solid', borderRadius: 8, padding: 10 },
  mapWrap: { border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' },
  mapCanvas: { width: '100%', height: 260 },
  emptyCard: { background: 'white', border: '1px dashed #cbd5e1', borderRadius: 10, padding: 16, color: '#64748b', marginTop: 10 },
  emptyState: { textAlign: 'center', padding: '52px 0', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' },
  primaryBtn: { background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontWeight: 600 },
};
