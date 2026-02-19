import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { api, setTokenGetter } from './api';
import { AppUser, RouteProfile } from './types';
import { Dashboard } from './components/Dashboard';
import { ProfileSettings } from './components/ProfileSettings';

type View = 'dashboard' | 'settings';

function App() {
  const {
    isLoading,
    isAuthenticated,
    loginWithRedirect,
    logout,
    user: auth0User,
    getAccessTokenSilently,
    getIdTokenClaims, // Dodano: potrzebne do fallbacku na ID Token
  } = useAuth0();

  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [activeProfile, setActiveProfile] = useState<RouteProfile | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [dataError, setDataError] = useState<string | null>(null);

  // Rejestruj getter tokena raz – api.ts używa go przy każdym fetch
  useEffect(() => {
    setTokenGetter(async () => {
      if (!isAuthenticated) return null;
      try {
        // Fallback: check VITE_ prefixed vars first, then AUTH0_ prefixed vars
        const audience =
          (import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined) ||
          (import.meta.env.AUTH0_AUDIENCE as string | undefined);

        if (audience) {
          // Jeśli mamy audience (skonfigurowane API), pobieramy Access Token (JWT)
          return await getAccessTokenSilently({ 
            authorizationParams: { audience } 
          });
        }

        // Jeśli NIE mamy audience, pobieramy ID Token (zawsze JWT)
        // Zapobiega to błędowi "Opaque Token" (Parts: 5) na backendzie
        const idToken = await getIdTokenClaims();
        return idToken?.__raw || null;

      } catch (e) {
        console.error('[Token]', e);
        return null;
      }
    });
  }, [isAuthenticated, getAccessTokenSilently, getIdTokenClaims]);

  const loadUserData = async () => {
    try {
      const data = await api.getMe();
      setAppUser(data.user);
      setActiveProfile(data.active_profile);
      setDataError(null);
    } catch (e: any) {
      setDataError(e.message);
    }
  };

  useEffect(() => {
    if (isAuthenticated && !isLoading) loadUserData();
    if (!isAuthenticated && !isLoading) {
      setAppUser(null);
      setActiveProfile(null);
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading) {
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
          {isAuthenticated ? (
            <>
              <span style={styles.userName}>
                {appUser?.display_name || auth0User?.email || auth0User?.name}
              </span>
              <button
                style={styles.btnLogout}
                onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
              >
                Wyloguj
              </button>
            </>
          ) : (
            <button
              style={styles.btnLogin}
              onClick={() => loginWithRedirect({ authorizationParams: { redirect_uri: window.location.origin } })}
            >
              Zaloguj się
            </button>
          )}
        </div>
      </header>

      <main style={styles.main}>
        {!isAuthenticated ? (
          <div style={styles.loginPrompt}>
            <div style={styles.loginCard}>
              <span style={{ fontSize: 48 }}>🚆🚌</span>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: '16px 0 8px' }}>Transit Tracker</h1>
              <p style={{ color: '#6b7280', marginBottom: 24 }}>
                Monitoruj połączenia WKD → ZTM w czasie rzeczywistym
              </p>
              {dataError && <p style={{ color: '#dc2626', marginBottom: 16 }}>{dataError}</p>}
              <button
                style={styles.btnLoginBig}
                onClick={() => loginWithRedirect({ authorizationParams: { redirect_uri: window.location.origin } })}
              >
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
    background: 'white', borderBottom: '1px solid #e5e7eb', padding: '12px 24px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 8 },
  logoText: { fontWeight: 800, fontSize: 18, color: '#1e3a5f' },
  navRight: { display: 'flex', alignItems: 'center', gap: 12 },
  userName: { fontSize: 14, color: '#6b7280' },
  btnLogin: { background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 },
  btnLogout: { background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: '#6b7280', fontSize: 14 },
  loadingScreen: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 },
  spinner: { width: 40, height: 40, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  main: { flex: 1 },
  loginPrompt: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 65px)' },
  loginCard: { background: 'white', borderRadius: 16, padding: '48px 40px', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', textAlign: 'center', maxWidth: 400 },
  btnLoginBig: { background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, padding: '14px 32px', cursor: 'pointer', fontWeight: 700, fontSize: 17, width: '100%' },
  content: { maxWidth: 680, margin: '0 auto', padding: '24px 16px' },
};

export default App;