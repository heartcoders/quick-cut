# Quick Cut

Mobile-first Web-App zum Aufnehmen, Importieren, Schneiden und Exportieren kurzer Videos. Läuft komplett lokal im Browser: kein Backend, kein Upload, kein Account.

**▶ Live-Demo: [heartcoders.github.io/quick-cut](https://heartcoders.github.io/quick-cut/)** (am besten auf dem Handy öffnen und „Zum Home-Bildschirm“ hinzufügen)

Gebaut mit Vite, Svelte 5 und TypeScript.

## Features

- **Aufnahme** mit Front-/Rückkamera: Tippen startet und stoppt, Halten nimmt auf, solange der Finger liegt
- **Import** aus der Galerie
- **Schneiden** mit Trim-Griffen oder in ±0,1-s-Schritten, Clips per Halten und Ziehen umsortieren
- **Bildausschnitt** pro Clip verschieben, Format 9:16, 1:1 oder 16:9
- **Übergänge**: Überblenden, Schieben, Wischen
- **Look** pro Clip: Farbfilter mit Stärkeregler, dazu Filmkorn, Vignette, VHS und Glitch, auf Wunsch für alle Clips
- **Ton**: Lautstärke pro Clip, Hintergrundmusik aus eigener Datei (Startpunkt, Ausblenden, automatisch leiser bei Sprache) und Voiceover fürs ganze Video
- **Export** als MP4 (1080p, H.264 + AAC), danach Teilen bzw. Sichern in Fotos oder Download
- **PWA**: installierbar und offline nutzbar

## Datenschutz

Videos verlassen nie das Gerät. Clips und Projekt liegen in der IndexedDB des Browsers, Rendering und Export laufen lokal (WebGL2 / WebCodecs).

## Browser-Anforderungen

- **HTTPS** ist Pflicht, sonst blockiert der Browser die Kamera (GitHub Pages und der Dev-Server liefern HTTPS).
- **Schnell-Export** braucht WebCodecs mit H.264/AAC-Encoder. Fehlt der, wird automatisch der Echtzeit-Export über MediaRecorder genutzt.
- Optimiert für Safari auf iOS, läuft aber auch in aktuellen Chromium-Browsern.

## Entwicklung

```bash
npm install
npm run dev      # HTTPS-Dev-Server, auch im LAN erreichbar
npm test         # Vitest
npm run check    # svelte-check + TypeScript
npm run build
```

**Test auf dem Handy:** `npm run dev` zeigt eine `Network`-URL (`https://<LAN-IP>:5173`). Diese auf dem Handy öffnen und die Warnung zum selbstsignierten Zertifikat einmal bestätigen.

Nützliche URL-Parameter:

- `?debug=1` zeigt Diagnose-Infos (Kamera, Wiedergabe, Audiopegel)
- `?export=v1` erzwingt den Echtzeit-Export

## Installation als App (PWA)

`npm run build` erzeugt Manifest, Icons und Service Worker (App-Shell offline). Damit der Service Worker aktiv wird, braucht es ein **vertrauenswürdiges** HTTPS-Zertifikat, also echtes Hosting oder `mkcert`. Mit dem selbstsignierten Dev-Zertifikat registriert der Browser keinen Service Worker. „Zum Home-Bildschirm“ funktioniert auf iOS trotzdem.

- Icons neu erzeugen: `npm run icons` (Quelle `public/logo.svg`)
- Tests ohne HTTPS auf `http://localhost`: `NO_HTTPS=1 npm run preview`

## Deployment (GitHub Pages)

Bei jedem Push auf `main` testet und baut `.github/workflows/deploy.yml` die App und veröffentlicht sie auf GitHub Pages. Dafür in den Repo-Einstellungen unter **Settings → Pages → Source** einmalig „GitHub Actions“ wählen.

Den Unterpfad setzt die Umgebungsvariable `BASE_PATH` (im Workflow automatisch `/<repo-name>/`). Für einen lokalen Build mit Unterpfad:

```bash
BASE_PATH=/quick-cut/ npm run build
```

Die App nutzt einen Hash-Router (`#/`, `#/settings`, `#/p/<projekt>/record|cut|export`) und läuft deshalb auf jedem statischen Hosting ohne Rewrite-Regeln.

## Ablauf

0. **Start** (`#/`): Projektliste (öffnen, umbenennen, duplizieren, löschen). „Aus Videos“ legt ein Projekt aus der Galerie an und springt in den Schnitt. Den Record-Button halten startet sofort eine Aufnahme in einem neuen Projekt, Tippen öffnet nur die Kamera. Unter ⚙ lässt sich die Kamera beim Öffnen festlegen (vorne, hinten, zuletzt benutzt).
1. **Aufnahme** (`#/p/<projekt>/record`): Tippen nimmt bis zum nächsten Tippen auf, Halten nimmt auf, solange der Finger liegt. Der Galerie-Button importiert Videos.
2. **Schneiden** (`#/p/<projekt>/cut`): Format wählen, Start und Ende per Griff oder ±0,1 s setzen, Ausschnitt per Ziehen verschieben, Clip oder alles abspielen. Zwischen den Clips lassen sich Übergänge wählen. Vorschau und Export laufen über denselben Renderer.
3. **Export** (`#/p/<projekt>/export`): exportieren, dann über das Share Sheet in Fotos sichern bzw. herunterladen.
   - **Schnell-Export (v2):** WebCodecs + Mediabunny rechnen Frame für Frame, deutlich schneller als Echtzeit.
   - **Echtzeit-Export (v1):** Canvas + MediaRecorder als Fallback.

## Struktur

- `src/lib/project`: Typen, IndexedDB (`idb`), Projekt-Store (Runes)
- `src/lib/router.svelte.ts`: Hash-Router
- `src/lib/capture`: Kamera, MediaRecorder, Record-Button (Zustandsmaschine)
- `src/lib/media`: Probe, Filmstreifen, Pipeline, Player (Trim-Bereich, A/B-Sequenz), Clip-Audio
- `src/lib/import`: Galerie-Import
- `src/lib/timeline`: Zeitberechnung (resolve, Trim-Griffe, Audio-Planung)
- `src/lib/renderer`: WebGL2-Compositor (Fallback Canvas 2D), Audio-Graph
- `src/lib/export`: Export v1 (Echtzeit) und v2 (WebCodecs/Mediabunny)
- `src/lib/platform`: Formatwahl, Teilen/Download, Wake Lock
- `src/routes`: die drei Screens
- `src/ui`: gemeinsame UI-Komponenten

## Mitmachen

Issues und Pull Requests sind willkommen. Vor einem PR bitte `npm test` und `npm run check` laufen lassen.

## Lizenz

[MIT](LICENSE) © 2026 Philipp Jordan
