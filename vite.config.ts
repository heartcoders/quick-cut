import { svelte } from '@sveltejs/vite-plugin-svelte'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// HTTPS ist Pflicht: ohne Secure Context blockiert der Browser die Kamera.
// `host: true` macht den Dev-Server im LAN erreichbar (Test auf dem Handy).
// NO_HTTPS=1: nur für automatisierte Tests auf http://localhost (localhost gilt
// als sicherer Kontext; Service Worker lassen sich mit selbstsigniertem
// Zertifikat in Chrome nicht registrieren).
const https = !process.env.NO_HTTPS
export default defineConfig({
  plugins: [
    svelte(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Quick Cut',
        short_name: 'Quick Cut',
        description: 'Kurze Videos aufnehmen, schneiden und exportieren – komplett auf dem Gerät.',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#000000',
        background_color: '#000000',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-Shell offline verfügbar; Clips liegen ohnehin lokal in IndexedDB.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true },
  preview: { host: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
