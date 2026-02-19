import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { RecommendationResult, TransferOption, RouteProfile } from '../types';
import { secToHHMM, formatDelay, formatBuffer, riskColor, riskLabel } from '../utils/time';
import { RefreshCw, AlertTriangle, CheckCircle, XCircle, Settings } from 'lucide-react';

const AUTO_REFRESH_INTERVAL = 25_000;

interface Props {
  activeProfile: RouteProfile | null;
  onGoToSettings: () => void;
}

export function Dashboard({ activeProfile, onGoToSettings }: Props) {
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchRecommendations = useCallback(async () => {
    if (!activeProfile) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRecommendation(activeProfile.id, 5);
      setResult(data);
      setLastRefresh(new Date());
      if (data.options.length > 0 && !selectedOptionId) {
        setSelectedOptionId(data.options[0].id);
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

  if (!activeProfile) {
    return (
      <div style={styles.emptyState}>
        <p style={{ fontSize: 18, color: '#6b7280' }}>Brak aktywnego profilu trasy.</p>
        <button style={styles.btnPrimary} onClick={onGoToSettings}>Skonfiguruj trasę</button>
      </div>
    );
  }

  const selectedOption = result?.options.find(o => o.id === selectedOptionId) ?? result?.options[0] ?? null;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.profileName}>{activeProfile.name}</h2>
          {lastRefresh && (
            <span style={styles.lastRefresh}>
              Odświeżono: {lastRefresh.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Live status */}
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
          <button style={styles.btnIcon} onClick={onGoToSettings} title="Ustawienia">
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={styles.errorBanner}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* No results */}
      {!loading && result && result.options.length === 0 && (
        <div style={styles.emptyState}>
          <p>Brak dostępnych połączeń w tej chwili.</p>
        </div>
      )}

      {/* TOP recommendation */}
      {selectedOption && (
        <BestOptionCard option={selectedOption} />
      )}

      {/* Alternatives list */}
      {result && result.options.length > 1 && (
        <div style={styles.alternativesSection}>
          <h3 style={styles.sectionTitle}>Alternatywy</h3>
          <div style={styles.alternativesList}>
            {result.options.map((opt, idx) => (
              <AlternativeCard
                key={opt.id}
                option={opt}
                index={idx}
                isSelected={opt.id === selectedOptionId}
                onClick={() => setSelectedOptionId(opt.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BestOptionCard({ option }: { option: TransferOption }) {
  const trainTime = secToHHMM(option.train.live_sec ?? option.train.scheduled_sec);
  const trainDelay = formatDelay(option.train.delay_sec);
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

      {/* Walk indicator */}
      <div style={styles.walkRow}>
        <span>🚶 {Math.floor(option.walk_sec / 60)} min dojścia</span>
      </div>

      {/* Variant indicator - KRYTYCZNY ELEMENT */}
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

function AlternativeCard({ option, index, isSelected, onClick }: {
  option: TransferOption;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const trainTime = secToHHMM(option.train.live_sec ?? option.train.scheduled_sec);
  const busTime = secToHHMM(option.bus.live_sec ?? option.bus.scheduled_sec);
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
          {option.bus_stop_variant && (
            <span style={{ ...styles.variantBadge }}>Wariant {option.bus_stop_variant}</span>
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

// ---- STYLES ----
const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 0 32px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  profileName: { margin: 0, fontSize: 22, fontWeight: 700 },
  lastRefresh: { fontSize: 12, color: '#9ca3af' },
  liveStatus: { display: 'flex', gap: 8, fontSize: 13, color: '#374151' },
  btnIcon: {
    background: 'none', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#374151'
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
  transportRow: {
    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12
  },
  transportIcon: { fontSize: 28 },
  transportInfo: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 },
  lineLabel: {
    background: '#1d4ed8', color: 'white', borderRadius: 6,
    padding: '2px 8px', fontWeight: 700, fontSize: 14
  },
  timeMain: { fontSize: 26, fontWeight: 800, color: '#111827' },
  delayBadge: { fontWeight: 700, fontSize: 15 },
  noLive: { color: '#d97706', fontSize: 13, fontWeight: 500 },
  headsign: { color: '#6b7280', fontSize: 14, textAlign: 'right' },
  walkRow: {
    color: '#6b7280', fontSize: 13, paddingLeft: 40, marginBottom: 10,
    borderLeft: '2px dashed #d1d5db', marginLeft: 19
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
  }
};
