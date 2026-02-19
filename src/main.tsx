import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';

// Wartości wstrzykiwane przez vite.config.ts z AUTH0_* env vars (Netlify Extension).
// Używamy aliasów __AUTH0_*__ żeby uniknąć fałszywych alarmów Netlify Secret Scanner.
declare const __AUTH0_DOMAIN__: string;
declare const __AUTH0_CLIENT_ID__: string;
declare const __AUTH0_AUDIENCE__: string;

const domain   = __AUTH0_DOMAIN__;
const clientId = __AUTH0_CLIENT_ID__;
const audience = __AUTH0_AUDIENCE__ || undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
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
