import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    define: {
      // Expose Auth0 variables directly to the frontend without VITE_ prefix requirements in Netlify
      'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(process.env.AUTH0_DOMAIN || env.AUTH0_DOMAIN),
      'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify(process.env.AUTH0_CLIENT_ID || env.AUTH0_CLIENT_ID),
      'import.meta.env.VITE_AUTH0_AUDIENCE': JSON.stringify(process.env.AUTH0_AUDIENCE || env.AUTH0_AUDIENCE),
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
