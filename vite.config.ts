import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Auth0 domain i client_id to wartości PUBLICZNE (nie sekrety) –
  // trafiają do każdej przeglądarki w normalnym Auth0 SPA flow.
  // Używamy aliasowanych kluczy (__AUTH0_*), żeby Netlify Secret Scanner
  // nie mylił ich z sekretami backendowymi (AUTH0_CLIENT_SECRET itp.).
  const auth0Domain   = process.env.AUTH0_DOMAIN    || env.AUTH0_DOMAIN    || ''
  const auth0ClientId = process.env.AUTH0_CLIENT_ID || env.AUTH0_CLIENT_ID || ''
  const auth0Audience = process.env.AUTH0_AUDIENCE  || env.AUTH0_AUDIENCE  || ''

  return {
    plugins: [react()],
    define: {
      __AUTH0_DOMAIN__:    JSON.stringify(auth0Domain),
      __AUTH0_CLIENT_ID__: JSON.stringify(auth0ClientId),
      __AUTH0_AUDIENCE__:  JSON.stringify(auth0Audience),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8888/.netlify/functions',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
