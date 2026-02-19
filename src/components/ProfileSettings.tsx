import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { RouteProfile } from '../types';
import { Plus, Trash2, CheckCircle, ArrowLeft, Edit2 } from 'lucide-react';

interface Props {
  onBack: () => void;
  onProfileChange: () => void;
}

export function ProfileSettings({ onBack, onProfileChange }: Props) {
  const [profiles, setProfiles] = useState<RouteProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [activeTab, setActiveTab] = useState<'profiles' | 'segments' | 'config'>('profiles');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const loadProfiles = async () => {
    try {
      const data = await api.getProfiles();
      setProfiles(data.profiles);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfiles(); }, []);

  const createProfile = async () => {
    if (!newName.trim()) return;
    await api.createProfile(newName.trim());
    setNewName('');
    await loadProfiles();
    onProfileChange();
  };

  const deleteProfile = async (id: string) => {
    if (!confirm('Usunąć profil?')) return;
    await api.deleteProfile(id);
    await loadProfiles();
    onProfileChange();
  };

  const setActive = async (id: string) => {
    await api.setActiveProfile(id);
    await loadProfiles();
    onProfileChange();
  };

  const saveEditName = async (id: string) => {
    if (!editingName.trim()) return;
    await api.updateProfile(id, { name: editingName.trim() });
    setEditingId(null);
    await loadProfiles();
    onProfileChange();
  };

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);

  return (
    <div style={styles.container}>
      <button style={styles.backBtn} onClick={onBack}>
        <ArrowLeft size={16} /> Powrót do dashboardu
      </button>

      <h2 style={styles.title}>Ustawienia</h2>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button style={{ ...styles.tab, ...(activeTab === 'profiles' ? styles.tabActive : {}) }}
          onClick={() => setActiveTab('profiles')}>Profile</button>
        {selectedProfileId && (
          <>
            <button style={{ ...styles.tab, ...(activeTab === 'segments' ? styles.tabActive : {}) }}
              onClick={() => setActiveTab('segments')}>Segmenty trasy</button>
            <button style={{ ...styles.tab, ...(activeTab === 'config' ? styles.tabActive : {}) }}
              onClick={() => setActiveTab('config')}>Czasy dojść</button>
          </>
        )}
      </div>

      {activeTab === 'profiles' && (
        <div>
          {/* Add new */}
          <div style={styles.addRow}>
            <input
              style={styles.input}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nazwa nowego profilu..."
              onKeyDown={e => e.key === 'Enter' && createProfile()}
            />
            <button style={styles.btnPrimary} onClick={createProfile}>
              <Plus size={16} /> Dodaj
            </button>
          </div>

          {/* List */}
          {loading ? <p>Ładowanie...</p> : (
            <div style={styles.profileList}>
              {profiles.map(p => (
                <div key={p.id} style={{ ...styles.profileCard, ...(p.is_active ? styles.profileCardActive : {}) }}>
                  <div style={styles.profileCardLeft}>
                    {editingId === p.id ? (
                      <input
                        style={{ ...styles.input, flex: 1 }}
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEditName(p.id); if (e.key === 'Escape') setEditingId(null); }}
                        autoFocus
                      />
                    ) : (
                      <span style={styles.profileName}>{p.name}</span>
                    )}
                    {p.is_active && <span style={styles.activeBadge}>Aktywny</span>}
                    {!p.is_valid && <span style={styles.invalidBadge}>⚠️ Błąd konfiguracji</span>}
                  </div>
                  <div style={styles.profileCardActions}>
                    {!p.is_active && (
                      <button style={styles.btnSmall} onClick={() => setActive(p.id)} title="Ustaw aktywny">
                        <CheckCircle size={15} />
                      </button>
                    )}
                    {editingId === p.id ? (
                      <button style={{ ...styles.btnSmall, color: '#16a34a' }} onClick={() => saveEditName(p.id)}>Zapisz</button>
                    ) : (
                      <button style={styles.btnSmall} onClick={() => { setEditingId(p.id); setEditingName(p.name); }} title="Edytuj nazwę">
                        <Edit2 size={15} />
                      </button>
                    )}
                    <button style={styles.btnSmall} onClick={() => { setSelectedProfileId(p.id); setActiveTab('segments'); }} title="Konfiguruj segmenty">
                      Konfiguruj
                    </button>
                    <button style={{ ...styles.btnSmall, color: '#dc2626' }} onClick={() => deleteProfile(p.id)} title="Usuń">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
              {profiles.length === 0 && <p style={{ color: '#9ca3af' }}>Brak profili. Utwórz pierwszy powyżej.</p>}
            </div>
          )}
        </div>
      )}

      {activeTab === 'segments' && selectedProfileId && (
        <SegmentsEditor profileId={selectedProfileId} profileName={selectedProfile?.name ?? ''} />
      )}

      {activeTab === 'config' && selectedProfileId && (
        <TransferConfigEditor profileId={selectedProfileId} profileName={selectedProfile?.name ?? ''} />
      )}
    </div>
  );
}

function SegmentsEditor({ profileId, profileName }: { profileId: string; profileName: string }) {
  const [rawJson, setRawJson] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSegments(profileId).then(data => {
      setRawJson(JSON.stringify(data.segments, null, 2));
      setLoading(false);
    }).catch(e => {
      setError(e.message);
      setLoading(false);
    });
  }, [profileId]);

  const save = async () => {
    setError(null);
    try {
      const segments = JSON.parse(rawJson);
      await api.replaceSegments(profileId, segments);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <h3 style={styles.sectionTitle}>Segmenty trasy: {profileName}</h3>
      <p style={styles.hint}>
        Edytuj segmenty w formacie JSON. Każdy segment: seq, mode (TRAIN/BUS/WALK),
        agency, from_stop_id, allowed_route_ids, stop_variants.
      </p>
      <div style={styles.jsonExample}>
        <strong>Przykład segmentu BUS ze stop_variants:</strong>
        <pre style={styles.pre}>{`{
  "seq": 3, "mode": "BUS", "agency": "ZTM",
  "from_stop_id": "325402",
  "allowed_route_ids": ["189", "401"],
  "stop_variants": {
    "189": [{"stop_id": "325402", "variant": null}],
    "401": [
      {"stop_id": "325402", "variant": "A", "note": "przy parkingu"},
      {"stop_id": "325403", "variant": "B", "note": "po stronie Biedronki"}
    ]
  }
}`}</pre>
      </div>
      {loading ? <p>Ładowanie...</p> : (
        <>
          <textarea
            style={styles.textarea}
            value={rawJson}
            onChange={e => setRawJson(e.target.value)}
            rows={20}
          />
          {error && <div style={styles.errorMsg}>{error}</div>}
          <button style={styles.btnPrimary} onClick={save}>
            {saved ? '✅ Zapisano!' : 'Zapisz segmenty'}
          </button>
        </>
      )}
    </div>
  );
}

function TransferConfigEditor({ profileId, profileName }: { profileId: string; profileName: string }) {
  const [exitBuf, setExitBuf] = useState(60);
  const [minBuf, setMinBuf] = useState(120);
  const [walkTimes, setWalkTimes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState(5);

  useEffect(() => {
    api.getTransferConfig(profileId).then(data => {
      if (data.config) {
        setExitBuf(data.config.exit_buffer_sec);
        setMinBuf(data.config.min_transfer_buffer_sec);
        setWalkTimes(data.config.walk_times ?? {});
      }
      setLoading(false);
    }).catch(e => {
      setError(e.message);
      setLoading(false);
    });
  }, [profileId]);

  const save = async () => {
    setError(null);
    try {
      await api.updateTransferConfig(profileId, {
        exit_buffer_sec: exitBuf,
        min_transfer_buffer_sec: minBuf,
        walk_times: walkTimes
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const addWalkTime = () => {
    if (!newKey.trim()) return;
    setWalkTimes(prev => ({ ...prev, [newKey.trim()]: newVal }));
    setNewKey('');
    setNewVal(5);
  };

  const removeWalkTime = (key: string) => {
    setWalkTimes(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  if (loading) return <p>Ładowanie...</p>;

  return (
    <div>
      <h3 style={styles.sectionTitle}>Czasy dojść: {profileName}</h3>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Exit buffer (sek) – czas wyjścia z pociągu</label>
        <input type="number" style={styles.inputSmall} value={exitBuf} onChange={e => setExitBuf(Number(e.target.value))} min={0} max={300} />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Minimalny bufor przesiadki (sek)</label>
        <input type="number" style={styles.inputSmall} value={minBuf} onChange={e => setMinBuf(Number(e.target.value))} min={0} max={600} />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Czasy dojścia na przystanek (minuty)</label>
        <p style={styles.hint}>Klucz: nazwa linii lub linia_wariant (np. 189, 401_A, 401_B)</p>
        <div style={styles.walkTimesList}>
          {Object.entries(walkTimes).map(([key, val]) => (
            <div key={key} style={styles.walkTimeRow}>
              <span style={styles.walkTimeKey}>{key}</span>
              <input
                type="number" style={styles.inputSmall}
                value={val}
                onChange={e => setWalkTimes(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                min={0} max={30}
              />
              <span style={{ fontSize: 13, color: '#6b7280' }}>min</span>
              <button style={{ ...styles.btnSmall, color: '#dc2626' }} onClick={() => removeWalkTime(key)}>✕</button>
            </div>
          ))}
        </div>
        <div style={styles.addRow}>
          <input style={{ ...styles.input, width: 120 }} placeholder="Linia (np. 401_A)" value={newKey} onChange={e => setNewKey(e.target.value)} />
          <input type="number" style={styles.inputSmall} value={newVal} onChange={e => setNewVal(Number(e.target.value))} min={0} max={30} />
          <span style={{ fontSize: 13, color: '#6b7280' }}>min</span>
          <button style={styles.btnPrimary} onClick={addWalkTime}><Plus size={14} /> Dodaj</button>
        </div>
      </div>

      {error && <div style={styles.errorMsg}>{error}</div>}
      <button style={styles.btnPrimary} onClick={save}>
        {saved ? '✅ Zapisano!' : 'Zapisz konfigurację'}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 0 32px' },
  backBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb',
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 16, padding: 0
  },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 20 },
  tabs: { display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #e5e7eb' },
  tab: {
    background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
    fontSize: 15, color: '#6b7280', borderBottom: '2px solid transparent', marginBottom: -2
  },
  tabActive: { color: '#2563eb', borderBottomColor: '#2563eb', fontWeight: 600 },
  addRow: { display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' },
  input: {
    border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px',
    fontSize: 15, flex: 1, outline: 'none'
  },
  inputSmall: {
    border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 10px',
    fontSize: 15, width: 80, outline: 'none'
  },
  btnPrimary: {
    background: '#2563eb', color: 'white', border: 'none', borderRadius: 8,
    padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap'
  },
  btnSmall: {
    background: 'none', border: '1px solid #e5e7eb', borderRadius: 6,
    padding: '4px 8px', cursor: 'pointer', fontSize: 13, display: 'flex',
    alignItems: 'center', gap: 4, color: '#374151'
  },
  profileList: { display: 'flex', flexDirection: 'column', gap: 10 },
  profileCard: {
    border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '12px 16px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white'
  },
  profileCardActive: { borderColor: '#2563eb', background: '#eff6ff' },
  profileCardLeft: { display: 'flex', alignItems: 'center', gap: 10, flex: 1 },
  profileName: { fontWeight: 600, fontSize: 16 },
  activeBadge: {
    background: '#dbeafe', color: '#1d4ed8', borderRadius: 6,
    padding: '2px 8px', fontSize: 12, fontWeight: 700
  },
  invalidBadge: {
    background: '#fef3c7', color: '#d97706', borderRadius: 6,
    padding: '2px 8px', fontSize: 12, fontWeight: 600
  },
  profileCardActions: { display: 'flex', gap: 6, alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: 700, marginBottom: 12 },
  hint: { fontSize: 13, color: '#6b7280', marginBottom: 12 },
  jsonExample: {
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: 12, marginBottom: 16
  },
  pre: { margin: 0, fontSize: 12, overflowX: 'auto' },
  textarea: {
    width: '100%', fontFamily: 'monospace', fontSize: 13,
    border: '1px solid #d1d5db', borderRadius: 8, padding: 12, boxSizing: 'border-box'
  },
  errorMsg: { color: '#dc2626', marginBottom: 12, fontSize: 14 },
  fieldGroup: { marginBottom: 20 },
  label: { display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 6 },
  walkTimesList: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 },
  walkTimeRow: { display: 'flex', gap: 8, alignItems: 'center' },
  walkTimeKey: {
    background: '#f3f4f6', borderRadius: 6, padding: '4px 10px',
    fontSize: 13, fontWeight: 600, minWidth: 80
  }
};
