import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Expose AUTH0_ variables to the client bundle
  envPrefix: ['VITE_', 'AUTH0_'],
})