# Design: KaTeX-Formeln, Streaming-Fix, Dark Mode

**Datum:** 2026-06-10  
**Projekt:** Safari AI Agent Extension  
**Scope:** popup.html / popup.css / popup.js

---

## Übersicht

Drei unabhängige Verbesserungen an der Extension-UI:

1. **KaTeX** — LaTeX-Formeln (`$...$`, `$$...$$`) rendern
2. **Streaming-Fix** — Ruckler und Scroll-Jank beim Streaming beseitigen
3. **Dark Mode** — systembasierter Dark Mode pro Provider-Theme

---

## 1. KaTeX-Integration

### Ziel
LaTeX-Formeln in AI-Antworten korrekt rendern. Inline (`$...$`) und Display-Block (`$$...$$`).

### Lösung
- KaTeX als lokale Ressource ins Extension-Bundle aufnehmen: `katex.min.js`, `katex.min.css`, plus Fonts-Ordner
- `popup.html` lädt KaTeX-CSS im `<head>` und KaTeX-JS vor `popup.js`
- `renderMathInElement()` wird **nach** dem Ende des Streamings einmalig auf der fertigen Bubble aufgerufen, nicht während des Streamings (verhindert Konflikte mit halbfertigen Formeln)
- KaTeX-Optionen: `delimiters: [{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}]`, `throwOnError: false` (fehlerhafte Formeln fallen auf Plain-Text zurück)
- Keine CDN-Abhängigkeit: alles lokal gebundled (Safari Extensions müssen offline funktionieren)

### Dateien betroffen
- `popup.html` — Script/Style-Tags für KaTeX
- `popup.js` — `renderMathInElement(bubble)` nach Stream-Ende aufrufen
- `popup.css` — ggf. `.katex-display` margin anpassen
- `manifest.json` — kein Eintrag nötig: KaTeX-Ressourcen werden vom Popup selbst geladen, nicht von Content-Scripts
- Neuer Ordner: `Resources/katex/` mit `katex.min.js`, `katex.min.css`, `fonts/`

---

## 2. Streaming ohne Ruckler

### Problem
Jeder eingehende Chunk schreibt sofort in den DOM → Layout-Reflow bei jedem Zeichen. Außerdem: Auto-Scroll reißt den User beim Nachlesen nach unten.

### Lösung

**Gebatchte DOM-Updates:**
- Chunks werden in einem String-Buffer (`streamBuffer`) akkumuliert
- Ein `setTimeout(flush, 50)` leert den Buffer alle 50 ms in den DOM — statt bei jedem Chunk
- Das `flush()` ruft `requestAnimationFrame` auf für Paint-Sync und vermeidet Forced-Layout

**Intelligenter Auto-Scroll:**
- Vor jedem Scroll-Update prüfen: `scrollTop + clientHeight >= scrollHeight - 50`
- Nur scrollen wenn der User schon am Ende war — wer hochgescrollt hat zum Nachlesen wird nicht zurückgezogen
- Nach Stream-Ende: einmaliger `scrollTo({ behavior: 'smooth' })` wenn User am Ende

**Bubble-Mindesthöhe:**
- `.message-bubble.ai` bekommt `min-height: 1lh` damit die Bubble nicht von Höhe 0 startet und das erste Zeichen keinen großen Layout-Sprung auslöst

### Dateien betroffen
- `popup.js` — Streaming-Loop umbauen: Buffer + Flush-Timer
- `popup.css` — `min-height: 1lh` auf `.message-bubble.ai`

---

## 3. Dark Mode pro Provider

### Ziel
Jedes Provider-Theme hat einen abgestimmten Dark-Mode der automatisch aktiv wird wenn macOS auf Dark wechselt. Kein manueller Toggle, kein JS.

### Lösung
`@media (prefers-color-scheme: dark)` Blöcke in `popup.css` für jedes Theme. Der Browser reagiert automatisch auf Systemwechsel.

### Paletten

| Token | Default Hell | Default Dunkel |
|---|---|---|
| `--color-canvas` | `#f5f1ec` | `#1c1a17` |
| `--color-surface-1` | `#ffffff` | `#242220` |
| `--color-surface-2` | `#ebe7e1` | `#2e2b27` |
| `--color-ink` | `#111111` | `#e8e5e0` |
| `--color-ink-muted` | `#626260` | `#9c9890` |
| `--color-hairline` | `#d3cec6` | `#3a3733` |
| `--color-accent` | `#ff5600` | `#ff6b1a` (leicht heller für Kontrast) |

Analog für alle 4 Provider-Themes (Anthropic, OpenAI, Gemini, Lokal) — jeweils mit passendem Canvas-Ton und erhaltener Akzentfarbe.

**Besonderheiten:**
- `<select>` und `<input>` in Safari Extensions erben nicht immer System-Dark-Mode → explizit `color-scheme: dark` auf dem `:root` setzen im Dark-Block
- SVG-Icons in den Buttons sind `currentColor` → funktionieren automatisch
- KaTeX-Formeln: KaTeX hat kein eingebautes Dark-Mode, aber da Text `currentColor` nutzt genügt es dass `--color-ink` korrekt gesetzt ist

### Dateien betroffen
- `popup.css` — Dark-Mode-Blöcke für `:root` und alle `[data-theme="..."]`

---

## Reihenfolge der Implementierung

1. Dark Mode CSS (keine Logik-Änderungen, reines CSS, einfach zu testen)
2. Streaming-Fix in popup.js (unabhängig von KaTeX)
3. KaTeX-Bundle einbinden + renderMathInElement aufrufen

---

## Nicht in Scope
- Manueller Dark-Mode-Toggle
- KaTeX-Rendering während des Streamings
- Änderungen am Backend / background.js
