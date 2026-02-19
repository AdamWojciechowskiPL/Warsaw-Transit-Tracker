import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';

// Fallback logic: check VITE_ prefixed vars first, then AUTH0_ prefixed vars
const domain =
  (import.meta.env.VITE_AUTH0_DOMAIN as string | undefined) ||
  (import.meta.env.AUTH0_DOMAIN as string | undefined);

const clientId =
  (import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined) ||
  (import.meta.env.AUTH0_CLIENT_ID as string | undefined);

const audience =
  (import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined) ||
  (import.meta.env.AUTH0_AUDIENCE as string | undefined);

const rootElement = document.getElementById('root')!;

if (!domain || !clientId) {
  console.error('[Auth0] Missing configuration. Set VITE_AUTH0_DOMAIN/CLIENT_ID or AUTH0_DOMAIN/CLIENT_ID.');
  
  ReactDOM.createRoot(rootElement).render(
    <div style={{ 
      fontFamily: 'system-ui, -apple-system, sans-serif', 
      padding: '40px 20px', 
      maxWidth: '600px', 
      margin: '0 auto', 
      textAlign: 'center' 
    }}>
      <h1 style={{ fontSize: '24px', marginBottom: '16px', color: '#1f2937' }}>Configuration Error</h1>
      <p style={{ color: '#4b5563', marginBottom: '24px', lineHeight: 1.5 }}>
        The application could not start because Auth0 configuration is missing.
      </p>
      <div style={{ 
        background: '#f3f4f6', 
        padding: '16px', 
        borderRadius: '8px', 
        textAlign: 'left',
        fontSize: '14px',
        color: '#374151',
        fontFamily: 'monospace'
      }}>
        <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>Required Environment Variables:</p>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          <li>VITE_AUTH0_DOMAIN <span style={{ color: '#6b7280' }}>(or AUTH0_DOMAIN)</span></li>
          <li>VITE_AUTH0_CLIENT_ID <span style={{ color: '#6b7280' }}>(or AUTH0_CLIENT_ID)</span></li>
        </ul>
      </div>
    </div>
  );
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Auth0Provider
        domain={domain}
        clientId={clientId}
        authorizationParams={{
          redirect_uri: window.location.origin,
          ...(audience ? { audience } : {}),
          scope: 'openid profile email',
        }}
      >
        <App />
      </Auth0Provider>
    </React.StrictMode>
  );
}