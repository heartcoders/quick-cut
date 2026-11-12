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

## Installation als App (PWA)

`npm run build` erzeugt Manifest, Icons und Service Worker (App-Shell offline). Damit der Service Worker auf dem Handy aktiv wird, braucht es ein **vertrauenswürdiges** HTTPS-Zertifikat (echtes Hosting oder `mkcert`); mit dem selbstsignierten Dev-Zertifikat registriert der Browser keinen Service Worker. „Zum Home-Bildschirm“ funktioniert auf iOS trotzdem.

- Icons neu erzeugen: `npm run icons` (Quelle `public/logo.svg`)
- Tests ohne HTTPS auf `http://localhost`: `NO_HTTPS=1 npm run preview`

## Ablauf

1. **Aufnahme** (`#/record`): Tippen = Aufnahme bis zum nächsten Tippen, Halten = solange der Finger liegt. Galerie-Button importiert Videos.
2. **Schneiden** (`#/cut`): Start/Ende per Griff oder ±0,1 s, Clip oder alles abspielen. Zwischen den Clips Übergänge (Überblenden, Schieben, Wischen) wählen – Vorschau und Export laufen über denselben Renderer.
3. **Export** (`#/export`): Format 9:16 / 1:1 / 16:9 wählen und exportieren, dann über das Share Sheet in Fotos sichern bzw. herunterladen.
   - **Schnell-Export (v2):** WebCodecs + Mediabunny, Frame für Frame, deutlich schneller als Echtzeit, H.264 + AAC. Wird automatisch genutzt, wenn der Browser es kann.
   - **Echtzeit-Export (v1):** Canvas + MediaRecorder als Fallback. Erzwingen mit `?export=v1` in der URL.

Clips lassen sich per **Halten und Ziehen** in der Clip-Leiste umsortieren.

## Struktur

- `src/lib/project` – Typen, IndexedDB (`idb`), Projekt-Store (Runes)
- `src/lib/router.svelte.ts` – Hash-Router (`#/record`, `#/cut`, `#/export`)
- `src/lib/capture` – Kamera, MediaRecorder, Record-Button (Zustandsmaschine)
- `src/lib/media` – Probe, Filmstreifen, Pipeline, Player (Trim-Bereich, A/B-Sequenz)
- `src/lib/import` – Galerie-Import
- `src/lib/timeline` – Zeitberechnung (resolve, Trim-Griffe)
- `src/lib/renderer` – WebGL2-Compositor (Fallback Canvas 2D), Audio-Graph
- `src/lib/export` – Export v1 (Echtzeit) und v2 (WebCodecs/Mediabunny)
- `src/lib/platform` – Formatwahl, Teilen/Download, Wake Lock
- `src/routes` – die drei Screens
- `src/ui` – gemeinsame UI-Komponenten
