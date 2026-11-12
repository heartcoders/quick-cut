# Quick Cut

Mobile-first Web App zum Aufnehmen, Importieren, Schneiden und Exportieren kurzer Videos – komplett lokal im Browser (Vite + Svelte 5 + TypeScript, kein Backend).

## Entwicklung

```bash
npm install
npm run dev      # HTTPS-Dev-Server, auch im LAN erreichbar
npm test         # Vitest
npm run check    # svelte-check + TypeScript
npm run build
```

**Test auf dem Handy:** `npm run dev` zeigt eine `Network`-URL (`https://<LAN-IP>:5173`). Auf dem Handy öffnen und die Warnung zum selbstsignierten Zertifikat einmal bestätigen. HTTPS ist Pflicht, sonst blockiert der Browser die Kamera.

## Struktur

- `src/lib/project` – Typen, IndexedDB (`idb`), Projekt-Store (Runes)
- `src/lib/router.svelte.ts` – Hash-Router (`#/record`, `#/cut`, `#/export`)
- `src/routes` – die drei Screens
- `src/ui` – gemeinsame UI-Komponenten
