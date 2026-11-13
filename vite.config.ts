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
// BASE_PATH: Unterpfad beim Hosting, z. B. `/quick-cut/` für GitHub Pages.
const base = process.env.BASE_PATH ?? '/'
export default defineConfig({
  base,
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    svelte(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      // Registrierung selbst (src/lib/platform/pwaUpdate.svelte.ts): Update-Prüfung und Neuladen im Leerlauf.
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Quick Cut',
        short_name: 'Quick Cut',
        description: 'Kurze Videos aufnehmen, schneiden und exportieren – komplett auf dem Gerät.',
        lang: 'de',
        // Relativ zu `base`, damit die Installation auch unter einem Unterpfad klappt.
        start_url: './',
        scope: './',
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
        // Gesichtserkennung (WASM ~15 MB, Modell) nicht vorab laden, sondern
        // beim ersten Benutzen cachen – danach offline verfügbar.
        globIgnores: ['**/mediapipe/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(mediapipe|models)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'face-detection', expiration: { maxEntries: 10 } },
          },
        ],
        navigateFallback: 'index.html',
        // Neue Version sofort aktivieren (bei injectRegister: false setzt das Plugin das nicht selbst).
        skipWaiting: true,
        clientsClaim: true,
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
