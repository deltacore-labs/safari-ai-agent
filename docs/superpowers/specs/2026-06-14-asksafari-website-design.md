# AskSafari Website — Design Spec

**Date:** 2026-06-14  
**Status:** Approved

---

## Overview

A static marketing website for **AskSafari** — a Safari browser extension that lets users chat with Claude, Gemini, or local AI models in context of the current web page. Hosted on GitHub Pages, no build tools, no frameworks.

---

## Goals

- Present AskSafari to potential users clearly and convincingly
- Satisfy German legal requirements (Impressum §5 TMG, Datenschutzerklärung)
- Provide clean, deep-linkable URLs for `/impressum` and `/datenschutz`
- Be deployable with zero configuration via GitHub Pages

---

## Design Language

### Style
**Glassmorphism Dark** — trendy AI-tool aesthetic matching the target audience.

### Colors
| Token | Value | Use |
|-------|-------|-----|
| `--canvas` | `#070711` | Page background |
| `--text` | `#ffffff` | Primary text |
| `--text-muted` | `rgba(255,255,255,0.6)` | Secondary text |
| `--accent` | `#3ecf8e` | CTAs, highlights (only chromatic event) |
| `--blob-purple` | `#6b01c2` | Background gradient blob |
| `--blob-blue` | `#054cff` | Background gradient blob |
| `--glass-bg` | `rgba(255,255,255,0.04)` | Card background |
| `--glass-border` | `rgba(255,255,255,0.08)` | Card border |

### Background
Two `radial-gradient` blobs with `filter: blur(120px)` and low opacity — one purple top-left, one blue bottom-right — fixed behind all content.

### Glass Cards
```css
background: rgba(255,255,255,0.04);
backdrop-filter: blur(16px);
border: 1px solid rgba(255,255,255,0.08);
border-radius: 16px;
```

### Typography
- **Font:** Inter (Google Fonts, free)
- **Display:** 56px / weight 700 / line-height 1.1 / letter-spacing -1.5px
- **Subhead:** 18px / weight 400 / line-height 1.6
- **Body:** 16px / weight 400 / line-height 1.6
- **Small/caption:** 13px / weight 400

### Spacing
Base unit: 8px. Sections separated by 96px vertical padding.

---

## File Structure

```
website/
├── index.html          # Landing Page (One-Pager)
├── impressum.html      # Impressum — standalone page
├── datenschutz.html    # Datenschutzerklärung — standalone page
├── assets/
│   ├── style.css       # All styles, shared across all three pages
│   ├── screenshot.png  # Extension popup screenshot (placeholder)
│   └── icon.png        # AskSafari icon (placeholder)
└── .nojekyll           # Prevents GitHub Pages from running Jekyll
```

No npm, no build step. Pure HTML/CSS. Works as-is on GitHub Pages.

---

## Page: index.html

### Sections (top to bottom)

#### 1. Nav
- Left: `AskSafari` wordmark in white, bold
- Right: `Für Safari installieren →` — solid Emerald button, links to GitHub Releases or App Store
- Sticky on scroll, `backdrop-filter: blur(8px)` + subtle border-bottom

#### 2. Hero
- **Eyebrow:** `Kostenlos · Open Source · Für Safari`  (small, muted, letter-spaced)
- **Headline:** `Dein KI-Assistent für jede Webseite`
- **Subtext:** `Frage Claude, Gemini oder ein lokales Modell — direkt während du browst. AskSafari liest die Seite mit und antwortet im Kontext.`
- **CTA Primary (Emerald):** `Für Safari installieren`
- **CTA Secondary (ghost):** `Quellcode auf GitHub`
- **Right column:** Screenshot of extension popup (assets/screenshot.png) — floating glass card with subtle box-shadow glow in Emerald

#### 3. Features
5 glass cards in a 3+2 grid layout (3 top row, 2 bottom row centered):

| Icon | Title | Description |
|------|-------|-------------|
| ✦ | Multi-Model | Claude, Gemini & Ollama — du wählst das Modell |
| ◉ | Seitenkontext | AskSafari liest mit, was du gerade siehst |
| ⬡ | Privat by Design | Mit Ollama bleiben alle Daten auf deinem Gerät |
| ▤ | Gesprächsverlauf | Alle Chats gespeichert & durchsuchbar |
| ⊕ | Kostenlos & Open Source | Kein Abo, kein Tracking, kein Konto nötig |

#### 4. How it works
3 numbered steps in a horizontal row:
1. **Extension installieren** — API-Key für Claude oder Gemini eingeben, oder Ollama lokal starten
2. **Popup öffnen** — Klick auf das AskSafari-Icon in der Safari-Toolbar
3. **Fragen stellen** — Der AI antwortet mit vollem Kontext der aktuellen Seite

#### 5. CTA Banner
Full-width glass card with:
- Headline: `Bereit loszulegen?`
- Subtext: `Kostenlos installieren — keine Registrierung, kein Abo.`
- Button (Emerald): `Für Safari installieren →`

#### 6. Footer
- Links: `Impressum` · `Datenschutz` · `GitHub`
- Copyright: `© 2026 Stefan Friedrich`
- Small, muted text, centered

---

## Page: impressum.html

Standalone page, same nav + footer as index.html.

**Content (§5 TMG):**
```
Angaben gemäß § 5 TMG

Stefan Friedrich
Seckenheimer Landstraße 4A / 138
68163 Mannheim

E-Mail: delta.corelabs@gmail.com

Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV:
Stefan Friedrich
(Adresse wie oben)
```

---

## Page: datenschutz.html

Standalone page, same nav + footer as index.html.

**Content sections:**
1. **Verantwortlicher** — Stefan Friedrich, Adresse, E-Mail
2. **Erhebung von Daten** — Diese Website erhebt keine personenbezogenen Daten, setzt keine Cookies und verwendet kein Tracking.
3. **Hosting** — Die Website wird über GitHub Pages (GitHub Inc., 88 Colin P Kelly Jr St, San Francisco, CA 94107, USA) gehostet. Beim Aufruf werden technische Daten (IP-Adresse, Zeitstempel) durch GitHub verarbeitet. Datenschutzerklärung GitHub: https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement
4. **Browser-Extension** — Die AskSafari-Extension speichert API-Keys und Gesprächsverläufe ausschließlich lokal im Browser (Safari Storage). Es werden keine Daten an eigene Server übertragen. API-Anfragen gehen direkt vom Browser des Nutzers an den jeweiligen KI-Anbieter (Anthropic, Google, Ollama).
5. **Ihre Rechte** — Auskunft, Berichtigung, Löschung nach DSGVO Art. 15–17. Kontakt: delta.corelabs@gmail.com

---

## Responsive Behavior

| Breakpoint | Changes |
|-----------|---------|
| Desktop (>768px) | Hero: 2-column (text left, screenshot right). Features: 3+2 grid |
| Mobile (≤768px) | Hero: single column, screenshot below text. Features: 1 column. Nav: hide links, keep CTA button |

---

## Legal Notes

- Impressum is required under §5 TMG (Telemediengesetz) for German website operators
- Datenschutzerklärung is required under DSGVO (EU) / BDSG (DE)
- No cookie banner needed — no cookies, no analytics, no tracking
- GitHub Pages hosting must be mentioned in Datenschutz as data processor

---

## Assets Needed

| File | Description | Status |
|------|-------------|--------|
| `assets/screenshot.png` | Screenshot of the extension popup | Placeholder needed |
| `assets/icon.png` | AskSafari app icon | Placeholder needed |

Screenshots can be taken directly from the Safari extension in Xcode Simulator or on a real device.
