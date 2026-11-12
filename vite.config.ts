import { svelte } from '@sveltejs/vite-plugin-svelte'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vitest/config'

// HTTPS ist Pflicht: ohne Secure Context blockiert der Browser die Kamera.
// `host: true` macht den Dev-Server im LAN erreichbar (Test auf dem Handy).
export default defineConfig({
  plugins: [svelte(), basicSsl()],
  server: { host: true },
  preview: { host: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
