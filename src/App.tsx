import React, { useEffect, useState } from 'react';
import netlifyIdentity from 'netlify-identity-widget';
import { api } from './api';
import { AppUser, RouteProfile } from './types';
import { Dashboard } from './components/Dashboard';
import { ProfileSettings } from './components/ProfileSettings';

type View = 'dashboard' | 'settings';

function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [activeProfile, setActiveProfile] = useState<RouteProfile | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadUserData = async () => {
    try {
      const data = await api.getMe();
      setUser(data.user);
      setActiveProfile(data.active_profile);
      setAuthError(null);
    } catch (e: any) {
      console.error('Failed to load user data:', e);
      setAuthError(e.message);
    }
  };

  useEffect(() => {
    // Inicjalizacja widgetu
    netlifyIdentity.init({ locale: 'pl' });

    const currentUser = netlifyIdentity.currentUser();

    if (currentUser) {
      // Jeśli user jest zalogowany w widgecie, pobierz dane z backendu
      loadUserData().finally(() => setAuthLoading(false));
    } else {
      setAuthLoading(false);
    }

    // Event listeners
    netlifyIdentity.on('login', () => {
      netlifyIdentity.close();
      setAuthLoading(true);
      loadUserData().finally(() => setAuthLoading(false));
    });

    netlifyIdentity.on('logout', () => {
      setUser(null);
      setActiveProfile(null);
      setAuthLoading(false);
    });
    
    // Cleanup
    return () => {
      netlifyIdentity.off('login');
      netlifyIdentity.off('logout');
    };
  }, []);

  const handleLogin = () => netlifyIdentity.open();
  const handleLogout = () => netlifyIdentity.logout();

  if (authLoading) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.spinner} />
        <p>Ładowanie...</p>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={{ fontSize: 22 }}>🚆</span>
          <span style={styles.logoText}>Transit Tracker</span>
        </div>
        <div style={styles.navRight}>
          {user ? (
            <>
              <span style={styles.userName}>{user.display_name || user.email}</span>
              <button style={styles.btnLogout} onClick={handleLogout}>Wyloguj</button>
            </>
          ) : (
            <button style={styles.btnLogin} onClick={handleLogin}>Zaloguj się</button>
          )}
        </div>
      </header>

      <main style={styles.main}>
        {!user ? (
          <div style={styles.loginPrompt}>
            <div style={styles.loginCard}>
              <span style={{ fontSize: 48 }}>🚆🚌</span>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: '16px 0 8px' }}>Transit Tracker</h1>
              <p style={{ color: '#6b7280', marginBottom: 24 }}>
                Monitoruj połączenia WKD → ZTM w czasie rzeczywistym
              </p>
              {authError && <p style={{ color: '#dc2626', marginBottom: 16 }}>{authError}</p>}
              <button style={styles.btnLoginBig} onClick={handleLogin}>
                Zaloguj się / Zarejestruj
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.content}>
            {view === 'dashboard' ? (
              <Dashboard
                activeProfile={activeProfile}
                onGoToSettings={() => setView('settings')}
              />
            ) : (
              <ProfileSettings
                onBack={() => setView('dashboard')}
                onProfileChange={loadUserData}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: { minHeight: '100vh', background: '#f9fafb', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: {
    background: 'white', borderBottom: '1px solid #e5e7eb',
    padding: '12px 24px', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
    position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
  },
  logo: { display: 'flex', alignItems: 'center', gap: 8 },
  logoText: { fontWeight: 800, fontSize: 18, color: '#1e3a5f' },
  navRight: { display: 'flex', alignItems: 'center', gap: 12 },
  userName: { fontSize: 14, color: '#6b7280' },
  btnLogin: {
    background: '#2563eb', color: 'white', border: 'none',
    borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600
  },
  btnLogout: {
    background: 'none', border: '1px solid #e5e7eb',
    borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: '#6b7280', fontSize: 14
  },
  loadingScreen: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100vh', gap: 16
  },
  spinner: {
    width: 40, height: 40, border: '3px solid #e5e7eb',
    borderTopColor: '#2563eb', borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  main: { flex: 1 },
  loginPrompt: {
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    minHeight: 'calc(100vh - 65px)'
  },
  loginCard: {
    background: 'white', borderRadius: 16, padding: '48px 40px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.10)', textAlign: 'center', maxWidth: 400
  },
  btnLoginBig: {
    background: '#2563eb', color: 'white', border: 'none',
    borderRadius: 10, padding: '14px 32px', cursor: 'pointer',
    fontWeight: 700, fontSize: 17, width: '100%'
  },
  content: { maxWidth: 680, margin: '0 auto', padding: '24px 16px' }
};

export default App;
