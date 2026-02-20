import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { RecommendationResult, TransferOption, RouteProfile, Departure } from '../types';
import { secToHHMM, formatDelay, formatBuffer, riskColor, riskLabel } from '../utils/time';
import { RefreshCw, AlertTriangle, Settings, Activity, MapPin } from 'lucide-react';

const AUTO_REFRESH_INTERVAL = 25_000;

interface Props {
  activeProfile: RouteProfile | null;
  onGoToSettings: () => void;
}

export function Dashboard({ activeProfile, onGoToSettings }: Props) {
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [allOptions, setAllOptions] = useState<TransferOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  
  // Tryb live
  const [isLiveMode, setIsLiveMode] = useState(false);

  const fetchRecommendations = useCallback(async () => {
    if (!activeProfile) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRecommendation(activeProfile.id, 8) as RecommendationResult;

      // Backend zwraca kilka opcji przesiadek dla jednego kursu WKD.
      // Na dashboardzie pokazujemy tylko jedną (najlepszą) rekomendację
      // dla każdego odjazdu pierwszego etapu, a pełną listę trzymamy
      // do wykorzystania w trybie Live.
      setAllOptions(data.options);
      const dashboardOptions = getDashboardOptions(data.options);

      setResult({
        ...data,
        options: dashboardOptions,
      });
      setLastRefresh(new Date());
      if (dashboardOptions.length > 0 && !selectedOptionId) {
        const now = nowSecLocal();
        const firstFuture = dashboardOptions.find((opt) => !isTrainInTransit(opt, now));
        setSelectedOptionId((firstFuture ?? dashboardOptions[0]).id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeProfile, selectedOptionId]);

  useEffect(() => {
    fetchRecommendations();
    const interval = setInterval(fetchRecommendations, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchRecommendations]);

  // Jeśli jesteśmy w trybie live, ale wybrana opcja zniknęła (np. minęła),
  // znajdź pierwszą dostępną (najlepiej tę samą linię, lub po prostu pierwszą).
  useEffect(() => {
    if (isLiveMode && result) {
      const optExists = result.options.find(o => o.id === selectedOptionId);
      if (!optExists && result.options.length > 0) {
        setSelectedOptionId(result.options[0].id);
      }
    }
  }, [result, isLiveMode, selectedOptionId]);

  if (!activeProfile) {
    return (
      <div style={styles.emptyState}>
        <p style={{ fontSize: 18, color: '#6b7280' }}>Brak aktywnego profilu trasy.</p>
        <button style={styles.btnPrimary} onClick={onGoToSettings}>Skonfiguruj trasę</button>
      </div>
    );
  }

  const now = nowSecLocal();
  const inTransitDashboardOptions = (result?.options ?? []).filter((opt) => isTrainInTransit(opt, now));
  const futureDashboardOptions = (result?.options ?? []).filter((opt) => !isTrainInTransit(opt, now));
  const selectedOption = (result?.options ?? []).find(o => o.id === selectedOptionId)
    ?? futureDashboardOptions[0]
    ?? inTransitDashboardOptions[0]
    ?? null;
  const selectedFirstRideKey = selectedOption ? getFirstRideKey(selectedOption) : null;
  const transferChoices = selectedFirstRideKey
    ? sortTransfersForLive(allOptions.filter((o) => getFirstRideKey(o) === selectedFirstRideKey))
    : [];

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.profileName}>{isLiveMode ? '🔴 Tryb Live' : activeProfile.name}</h2>
          {lastRefresh && (
            <span style={styles.lastRefresh}>
              Odświeżono: {lastRefresh.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {result && (
            <div style={styles.liveStatus}>
              <span>{result.meta.live_status.wkd === 'available' ? '✅' : '❌'} WKD</span>
              <span>{result.meta.live_status.ztm === 'available' ? '✅' : '❌'} ZTM</span>
            </div>
          )}
          <button
            style={{ ...styles.btnIcon, ...(loading ? styles.spinning : {}) }}
            onClick={fetchRecommendations}
            disabled={loading}
            title="Odśwież"
          >
            <RefreshCw size={18} />
          </button>
          {!isLiveMode && (
            <button style={styles.btnIcon} onClick={onGoToSettings} title="Ustawienia">
              <Settings size={18} />
            </button>
          )}
          {isLiveMode && (
             <button style={styles.btnDanger} onClick={() => setIsLiveMode(false)} title="Zakończ trasę">
               Zakończ
             </button>
          )}
        </div>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {!loading && result && result.options.length === 0 && (
        <div style={styles.emptyState}>
          <p>Brak dostępnych połączeń w tej chwili.</p>
        </div>
      )}

      {isLiveMode && selectedOption ? (
        <LiveGuidanceView 
          option={selectedOption} 
          transferChoices={transferChoices}
          onSwitchAlternative={(id) => setSelectedOptionId(id)}
        />
      ) : (
        <>
          {inTransitDashboardOptions.length > 0 && (
            <div style={styles.alternativesSection}>
              <h3 style={styles.sectionTitle}>Połączenia w ruchu (jeszcze przed przesiadką)</h3>
              <div style={styles.alternativesList}>
                {inTransitDashboardOptions.map((opt) => (
                  <AlternativeCard
                    key={opt.id}
                    option={opt}
                    isSelected={opt.id === selectedOptionId}
                    onClick={() => {
                      setSelectedOptionId(opt.id);
                      setIsLiveMode(true);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {selectedOption && (
            <BestOptionCard 
              option={selectedOption} 
              onStartLive={() => setIsLiveMode(true)}
            />
          )}
          {futureDashboardOptions.length > 1 && (
            <div style={styles.alternativesSection}>
              <h3 style={styles.sectionTitle}>Alternatywy</h3>
              <div style={styles.alternativesList}>
                {futureDashboardOptions.map((opt) => (
                  <AlternativeCard
                    key={opt.id}
                    option={opt}
                    isSelected={opt.id === selectedOptionId}
                    onClick={() => setSelectedOptionId(opt.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function departureSec(departure: Departure): number {
  return departure.live_sec ?? departure.scheduled_sec;
}

/**
 * Klucz identyfikujący KURS POCIĄGU (używany w trybie Live do grupowania
 * wszystkich opcji autobusowych dla aktualnie monitorowanego składu WKD).
 * NIE używaj tego klucza do deduplikacji listy rekomendacji – tam potrzebny
 * jest szerszy klucz uwzględniający też autobus (getOptionDedupeKey).
 */
function getFirstRideKey(option: TransferOption): string {
  // Klucz musi być stabilny i rozróżniać kolejne odjazdy.
  // Nie polegamy wyłącznie na trip_id, bo bywa nieunikalne / brakujące.
  return `${option.train.route_id}:${option.train.stop_id}:${option.train.scheduled_sec}`;
}

/**
 * Klucz do deduplikacji opcji na liście rekomendacji.
 * Łączy kurs pociągu z kursem autobusu i wariantem przystanku,
 * dzięki czemu różne połączenia autobusowe dla tego samego pociągu
 * są traktowane jako osobne opcje (a nie składane w jedną).
 */
function getOptionDedupeKey(option: TransferOption): string {
  return `${getFirstRideKey(option)}:${option.bus.route_id}:${option.bus.scheduled_sec}:${option.bus_stop_variant ?? ''}`;
}

function optionChronologicalSec(option: TransferOption): number {
  return departureSec(option.train);
}

function riskScore(risk: TransferOption['risk']): number {
  if (risk === 'LOW') return 0;
  if (risk === 'MED') return 1;
  return 2;
}

function chooseBestTransferForFirstRide(options: TransferOption[]): TransferOption {
  return [...options].sort((a, b) => {
    const riskCmp = riskScore(a.risk) - riskScore(b.risk);
    if (riskCmp !== 0) return riskCmp;
    const bufferCmp = b.buffer_sec - a.buffer_sec;
    if (bufferCmp !== 0) return bufferCmp;
    return departureSec(a.bus) - departureSec(b.bus);
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

  const uniqueOptions = [...dedupedByTrainBus.values()]
    .map((group) => chooseBestTransferForFirstRide(group));

  const groupedByFirstRide = new Map<string, TransferOption[]>();
  for (const option of uniqueOptions) {
    const key = getFirstRideKey(option);
    const curr = groupedByFirstRide.get(key) ?? [];
    curr.push(option);
    groupedByFirstRide.set(key, curr);
  }

  return [...groupedByFirstRide.values()]
    .map((group) => chooseBestTransferForFirstRide(group))
    .sort((a, b) => optionChronologicalSec(a) - optionChronologicalSec(b));
}

function sortTransfersForLive(options: TransferOption[]): TransferOption[] {
  return [...options].sort((a, b) => {
    const aArrival = getTransferStationArrivalTime(a);
    const bArrival = getTransferStationArrivalTime(b);

    const arrivalCmp = aArrival - bArrival;
    if (arrivalCmp !== 0) return arrivalCmp;

    const busCmp = departureSec(a.bus) - departureSec(b.bus);
    if (busCmp !== 0) return busCmp;

    const bufferCmp = b.buffer_sec - a.buffer_sec;
    if (bufferCmp !== 0) return bufferCmp;

    return riskScore(a.risk) - riskScore(b.risk);
  });
}

function getTransferStationArrivalTime(option: TransferOption): number {
  if (option.train_transfer) {
    return option.train_transfer.live_sec ?? option.train_transfer.scheduled_sec;
  }
  if (option.train_transfer_time_sec) {
    return option.train_transfer_time_sec;
  }
  return option.ready_sec - option.walk_sec - option.exit_buffer_sec;
}

function isTrainInTransit(option: TransferOption, nowSec: number): boolean {
  const trainDepartureSec = departureSec(option.train);
  const transferArrivalSec = getTransferStationArrivalTime(option);
  return nowSec >= trainDepartureSec && nowSec < transferArrivalSec;
}

function BestOptionCard({ option, onStartLive }: { option: TransferOption; onStartLive: () => void }) {
  const trainTime = secToHHMM(option.train.live_sec ?? option.train.scheduled_sec);
  const trainDelay = formatDelay(option.train.delay_sec);
  
  const arrivalSec = getTransferStationArrivalTime(option);
  const arrivalTime = secToHHMM(arrivalSec);

  const busTime = secToHHMM(option.bus.live_sec ?? option.bus.scheduled_sec);
  const busDelay = formatDelay(option.bus.delay_sec);
  const riskC = riskColor(option.risk);

  return (
    <div style={{ ...styles.bestCard, borderColor: riskC }}>
      {/* Train row */}
      <div style={styles.transportRow}>
        <div style={styles.transportIcon}>🚂</div>
        <div style={styles.transportInfo}>
          <span style={styles.lineLabel}>WKD</span>
          <span style={styles.timeMain}>{trainTime}</span>
          {option.train.delay_sec !== null && (
            <span style={{ ...styles.delayBadge, color: option.train.delay_sec > 0 ? '#dc2626' : '#16a34a' }}>
              {trainDelay}
            </span>
          )}
          {!option.train.live_sec && (
            <span style={styles.noLive}>⚠️ Brak live</span>
          )}
        </div>
        <div style={styles.headsign}>{option.train.headsign}</div>
      </div>

      <div style={styles.arrivalRow}>
        <MapPin size={14} /> Dojazd do przesiadki: <strong>{arrivalTime}</strong>
      </div>

      {/* Walk indicator */}
      <div style={styles.walkRow}>
        <span>🚶 {Math.floor(option.walk_sec / 60)} min dojścia (planowo)</span>
      </div>

      {option.bus_stop_variant && (
        <div style={styles.variantBanner}>
          🚏 IDŹ NA PRZYSTANEK: <strong>WARIANT {option.bus_stop_variant}</strong>
          {option.bus.stop_id && <span style={styles.stopIdNote}> (stop: {option.bus.stop_id})</span>}
        </div>
      )}

      {/* Bus row */}
      <div style={styles.transportRow}>
        <div style={styles.transportIcon}>🚌</div>
        <div style={styles.transportInfo}>
          <span style={styles.lineLabel}>Linia {option.bus.route_id}</span>
          <span style={styles.timeMain}>{busTime}</span>
          {option.bus.delay_sec !== null && (
            <span style={{ ...styles.delayBadge, color: option.bus.delay_sec > 0 ? '#dc2626' : '#16a34a' }}>
              {busDelay}
            </span>
          )}
          {!option.bus.live_sec && (
            <span style={styles.noLive}>⚠️ Brak live</span>
          )}
        </div>
        <div style={styles.headsign}>{option.bus.headsign}</div>
      </div>

      {/* Buffer */}
      <div style={{ ...styles.bufferRow, backgroundColor: riskC + '18' }}>
        <span style={{ color: riskC, fontWeight: 700, fontSize: 18 }}>
          {riskLabel(option.risk)}
        </span>
        <span style={styles.bufferTime}>Bufor: {formatBuffer(option.buffer_sec)}</span>
      </div>

      {/* Start Live button */}
      <button style={styles.btnStartLive} onClick={onStartLive}>
        <Activity size={18} /> Podłącz trasę (Live)
      </button>

      {/* Warnings */}
      {option.warnings.length > 0 && (
        <div style={styles.warningsSection}>
          {option.warnings.map((w, i) => (
            <div key={i} style={styles.warningItem}><AlertTriangle size={14} /> {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveGuidanceView({ option, transferChoices, onSwitchAlternative }: { option: TransferOption; transferChoices: TransferOption[]; onSwitchAlternative: (id: string) => void }) {
  const trainDepartureSec = departureSec(option.train);
  const transferArrivalSec = getTransferStationArrivalTime(option);
  const busDepartureSec = departureSec(option.bus);

  const trainTime = secToHHMM(option.train.live_sec ?? option.train.scheduled_sec);
  const arrivalTime = secToHHMM(transferArrivalSec);
  const busTime = secToHHMM(option.bus.live_sec ?? option.bus.scheduled_sec);
  const riskC = riskColor(option.risk);

  const isRisky = option.risk === 'HIGH' || option.buffer_sec < 0;
  const nowSec = nowSecLocal();
  const livePosition = getLiveVehiclePositionLabel(nowSec, trainDepartureSec, transferArrivalSec, busDepartureSec);
  
  const alternatives = transferChoices.filter((o) => o.id !== option.id);

  return (
    <div style={styles.liveContainer}>
      {isRisky && (
        <div style={styles.liveAlert}>
          <AlertTriangle size={24} />
          <div>
            <strong>Zagrożona przesiadka!</strong>
            <div>Pojazd ucieknie lub masz ujemny bufor. Zobacz alternatywy poniżej.</div>
          </div>
        </div>
      )}

      <div style={{ ...styles.liveTimeline, borderLeftColor: riskC }}>
        <div style={styles.liveStep}>
          <div style={styles.liveStepDot}>🚂</div>
          <div style={styles.liveStepContent}>
            <div style={styles.liveStepTitle}>WKD do {option.train.headsign}</div>
            <div style={styles.liveStepTime}>
              Odjazd: <strong>{trainTime}</strong> {formatDelay(option.train.delay_sec)}
            </div>
            <div style={styles.liveStepTime}>Aktualna pozycja: <strong>{livePosition}</strong></div>
            <div style={styles.liveStepTime}>
              Dojazd na przesiadkę: <strong>{arrivalTime}</strong>
            </div>
            <div style={styles.liveStopsRow}>
              Kolejne przystanki:
              <span style={styles.stopChip}>{option.train.stop_id}</span>
              <span style={styles.stopArrow}>→</span>
              <span style={styles.stopChip}>{option.train_transfer?.stop_id ?? 'przesiadka'}</span>
              <span style={styles.stopArrow}>→</span>
              <span style={styles.stopChip}>{option.bus.stop_id}</span>
            </div>
          </div>
        </div>

        <div style={styles.liveStep}>
          <div style={styles.liveStepDot}>🚶</div>
          <div style={styles.liveStepContent}>
            <div style={styles.liveStepTitle}>Przejście pieszo</div>
            <div style={styles.liveStepTime}>
              Planowany czas dojścia: {Math.floor(option.walk_sec / 60)} min
            </div>
            {option.bus_stop_variant && (
              <div style={styles.liveVariantBadge}>
                Kieruj się na wariant: {option.bus_stop_variant}
              </div>
            )}
          </div>
        </div>

        <div style={styles.liveStep}>
          <div style={styles.liveStepDot}>🚌</div>
          <div style={styles.liveStepContent}>
            <div style={styles.liveStepTitle}>ZTM Linia {option.bus.route_id} do {option.bus.headsign}</div>
            <div style={styles.liveStepTime}>
              Odjazd: <strong>{busTime}</strong> {formatDelay(option.bus.delay_sec)}
            </div>
            <div style={{ ...styles.liveBuffer, color: riskC }}>
              Pozostało na przesiadkę: {formatBuffer(option.buffer_sec)}
            </div>
          </div>
        </div>
      </div>

      <div style={styles.liveMonitorInfo}>
        Monitoring live: opóźnienia WKD/ZTM i lista przesiadek odświeżają się automatycznie co 25 sekund.
      </div>

      {(isRisky || alternatives.length > 0) && (
        <div style={styles.liveAlternatives}>
          <h4 style={{ margin: '0 0 12px 0' }}>Najbliższe opcje przesiadki (sortowane wg realnego przyjazdu):</h4>
          {alternatives.length === 0 ? (
            <p style={{ fontSize: 14, color: '#6b7280' }}>Brak kolejnych opcji przesiadki dla monitorowanego kursu.</p>
          ) : (
            <div style={styles.alternativesList}>
              {alternatives.map(opt => (
                <AlternativeCard key={opt.id} option={opt} isSelected={false} onClick={() => onSwitchAlternative(opt.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlternativeCard({ option, isSelected, onClick }: { option: TransferOption; isSelected: boolean; onClick: () => void; }) {
  const trainTime = secToHHMM(option.train.live_sec ?? option.train.scheduled_sec);
  const busTime = secToHHMM(option.bus.live_sec ?? option.bus.scheduled_sec);
  const plannedBusTime = secToHHMM(option.bus.scheduled_sec);
  const riskC = riskColor(option.risk);

  return (
    <button
      style={{
        ...styles.altCard,
        borderColor: isSelected ? riskC : '#e5e7eb',
        backgroundColor: isSelected ? riskC + '10' : 'white'
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>🚂 {trainTime}</span>
          <span style={{ color: '#6b7280' }}>→</span>
          <span style={{ fontWeight: 600 }}>🚌 {option.bus.route_id} {busTime}</span>
          <span style={{ color: '#6b7280', fontSize: 12 }}>plan: {plannedBusTime}</span>
          <span style={{ fontSize: 12, color: option.bus.delay_sec && option.bus.delay_sec > 0 ? '#dc2626' : '#16a34a' }}>{formatDelay(option.bus.delay_sec)}</span>
          {option.bus_stop_variant && (
            <span style={styles.variantBadge}>Wariant {option.bus_stop_variant}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: riskC, fontWeight: 600 }}>{formatBuffer(option.buffer_sec)}</span>
          <span style={{ color: riskC, fontSize: 20 }}>
            {option.risk === 'LOW' ? '🟢' : option.risk === 'MED' ? '🟡' : '🔴'}
          </span>
        </div>
      </div>
    </button>
  );
}


function nowSecLocal(): number {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function getLiveVehiclePositionLabel(
  nowSec: number,
  trainDepartureSec: number,
  transferArrivalSec: number,
  busDepartureSec: number
): string {
  if (nowSec < trainDepartureSec) return 'przed odjazdem (na stacji początkowej)';
  if (nowSec < transferArrivalSec) return 'w drodze do przesiadki';
  if (nowSec < busDepartureSec) return 'na przesiadce / dojście do autobusu';
  return 'po przesiadce (autobus w trasie)';
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 0 32px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  profileName: { margin: 0, fontSize: 22, fontWeight: 700 },
  lastRefresh: { fontSize: 12, color: '#9ca3af' },
  liveStatus: { display: 'flex', gap: 8, fontSize: 13, color: '#374151' },
  btnIcon: {
    background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#374151'
  },
  btnDanger: {
    background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8,
    padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#dc2626', fontWeight: 600
  },
  spinning: { animation: 'spin 1s linear infinite' },
  btnPrimary: {
    background: '#2563eb', color: 'white', border: 'none', borderRadius: 8,
    padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 15
  },
  errorBanner: {
    background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
    padding: '10px 14px', color: '#dc2626', marginBottom: 16,
    display: 'flex', gap: 8, alignItems: 'center'
  },
  emptyState: {
    textAlign: 'center', padding: '48px 0', display: 'flex',
    flexDirection: 'column', alignItems: 'center', gap: 16
  },
  bestCard: {
    border: '2px solid', borderRadius: 12, padding: 20,
    background: 'white', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
  },
  transportRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  transportIcon: { fontSize: 28 },
  transportInfo: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flex: 1 },
  lineLabel: {
    background: '#1d4ed8', color: 'white', borderRadius: 6,
    padding: '2px 8px', fontWeight: 700, fontSize: 14
  },
  timeMain: { fontSize: 26, fontWeight: 800, color: '#111827' },
  delayBadge: { fontWeight: 700, fontSize: 15 },
  noLive: { color: '#d97706', fontSize: 13, fontWeight: 500 },
  headsign: { color: '#6b7280', fontSize: 14, width: '100%', marginTop: 2 },
  arrivalRow: {
    color: '#374151', fontSize: 14, paddingLeft: 40, marginBottom: 4,
    display: 'flex', alignItems: 'center', gap: 6
  },
  walkRow: {
    color: '#6b7280', fontSize: 13, paddingLeft: 40, marginBottom: 10,
    borderLeft: '2px dashed #d1d5db', marginLeft: 19, paddingBottom: 6
  },
  variantBanner: {
    background: '#1d4ed8', color: 'white', borderRadius: 8,
    padding: '10px 16px', fontSize: 16, fontWeight: 600,
    marginBottom: 12, textAlign: 'center'
  },
  stopIdNote: { fontSize: 12, opacity: 0.8 },
  bufferRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 8, padding: '12px 16px', marginTop: 8
  },
  bufferTime: { fontSize: 16, fontWeight: 600, color: '#374151' },
  btnStartLive: {
    marginTop: 16, width: '100%', background: '#10b981', color: 'white',
    border: 'none', borderRadius: 8, padding: '14px 20px', cursor: 'pointer',
    fontWeight: 700, fontSize: 16, display: 'flex', justifyContent: 'center',
    alignItems: 'center', gap: 8, transition: 'background 0.2s'
  },
  warningsSection: { marginTop: 10, paddingTop: 10, borderTop: '1px solid #f3f4f6' },
  warningItem: {
    display: 'flex', alignItems: 'center', gap: 6,
    color: '#d97706', fontSize: 13, marginBottom: 4
  },
  alternativesSection: { marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 10 },
  alternativesList: { display: 'flex', flexDirection: 'column', gap: 8 },
  altCard: {
    border: '1.5px solid', borderRadius: 10, padding: '12px 16px',
    cursor: 'pointer', width: '100%', textAlign: 'left', transition: 'all 0.15s'
  },
  variantBadge: {
    background: '#dbeafe', color: '#1d4ed8', borderRadius: 6,
    padding: '2px 8px', fontSize: 12, fontWeight: 700
  },
  liveContainer: {
    background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
  },
  liveAlert: {
    background: '#fef2f2', color: '#dc2626', border: '2px solid #fca5a5',
    borderRadius: 8, padding: '12px 16px', marginBottom: 20,
    display: 'flex', alignItems: 'center', gap: 12, fontSize: 15
  },
  liveTimeline: {
    borderLeft: '4px solid', marginLeft: 16, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 24
  },
  liveStep: { position: 'relative' },
  liveStepDot: {
    position: 'absolute', left: -44, top: 0, width: 36, height: 36,
    background: 'white', border: '2px solid #e5e7eb', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, zIndex: 2
  },
  liveStepContent: { background: '#f9fafb', padding: '12px 16px', borderRadius: 8, border: '1px solid #e5e7eb' },
  liveStepTitle: { fontWeight: 700, fontSize: 16, color: '#111827', marginBottom: 4 },
  liveStepTime: { fontSize: 14, color: '#4b5563', marginBottom: 2 },
  liveStopsRow: { marginTop: 8, fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  stopChip: { background: '#e5e7eb', borderRadius: 999, padding: '2px 8px', fontWeight: 600, fontSize: 12 },
  stopArrow: { color: '#9ca3af' },
  liveVariantBadge: {
    display: 'inline-block', marginTop: 8, background: '#1d4ed8', color: 'white',
    borderRadius: 6, padding: '4px 8px', fontWeight: 600, fontSize: 13
  },
  liveBuffer: { marginTop: 8, fontWeight: 700, fontSize: 15 },
  liveAlternatives: { marginTop: 24, paddingTop: 16, borderTop: '1px solid #e5e7eb' },
  liveMonitorInfo: {
    marginTop: 16,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: 600,
  }
};
