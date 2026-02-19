// Konwertuje sekundy od północy na HH:MM
export function secToHHMM(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Formatuje opóźnienie w sekundach jako +X min
export function formatDelay(delaySec: number | null): string {
  if (delaySec === null) return '';
  const minutes = Math.round(delaySec / 60);
  if (minutes === 0) return 'na czas';
  return minutes > 0 ? `+${minutes} min` : `${minutes} min`;
}

// Formatuje bufor w sekundach jako X min
export function formatBuffer(bufferSec: number): string {
  const minutes = Math.floor(bufferSec / 60);
  return `${minutes} min`;
}

export function riskColor(risk: 'LOW' | 'MED' | 'HIGH'): string {
  return risk === 'LOW' ? '#16a34a' : risk === 'MED' ? '#d97706' : '#dc2626';
}

export function riskLabel(risk: 'LOW' | 'MED' | 'HIGH'): string {
  return risk === 'LOW' ? '🟢 Niskie ryzyko' : risk === 'MED' ? '🟡 Średnie ryzyko' : '🔴 Wysokie ryzyko';
}
