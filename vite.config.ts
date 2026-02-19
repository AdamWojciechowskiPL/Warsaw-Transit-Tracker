import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Zmienne VITE_* są automatycznie wstrzykiwane przez Vite
// zarówno lokalnie (.env) jak i w Netlify (UI env vars).
// Nie potrzebujemy ręcznego `define` ani `loadEnv`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8888/.netlify/functions',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
