import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In development the app calls `/api/...` on its own origin and Vite
    // forwards it to the Go server, so there is no CORS and no second URL to
    // configure. Only used when the app is started with VITE_API_BASE=/api;
    // otherwise nothing is ever sent here. Point it elsewhere with API_TARGET.
    proxy: {
      '/api': process.env.API_TARGET ?? 'http://localhost:8080',
    },
  },
})
