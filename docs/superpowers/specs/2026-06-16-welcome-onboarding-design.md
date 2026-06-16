# Welcome Onboarding Overlay — Design Spec

## Overview

A first-launch onboarding overlay that introduces new users to the extension's key features. Shows once on first popup open, never again unless manually reset.

## Trigger

- On popup load, check `browser.storage.local` for key `welcome_seen`
- If absent → show overlay
- On dismiss (any path) → set `welcome_seen: true`

## Structure

Bottom-sheet modal overlay with blur backdrop. 4 sequential steps, each full-width within the sheet.

### Steps

| # | Icon | Title (DE) | Title (EN) |
|---|------|-----------|-----------|
| 1 | 👋 | Willkommen bei AI Agent | Welcome to AI Agent |
| 2 | 🌐 | Seitenkontext | Page Context |
| 3 | 🤖 | Web-Agent | Web Agent |
| 4 | ⚙️ | Einrichten | Set Up |

**Step 1 — Willkommen:** Short app description. "Dein KI-Assistent direkt im Safari-Browser."

**Step 2 — Seitenkontext:** Explains the Auto/On/Off page context toggle. "Ich lese die aktuelle Seite mit…"

**Step 3 — Web-Agent:** Explains the Agent section. "Beschreib eine Aufgabe — ich klicke, tippe und navigiere für dich."

**Step 4 — Einrichten:** CTA to open Settings. Primary button: "Einstellungen öffnen" → opens settings panel, sets `welcome_seen`. Secondary link: "Später einrichten" → just closes overlay.

## Navigation

- **Progress dots:** 4 dots, active dot expands to pill shape
- **Primary button:** "Weiter →" (steps 1–3), "Einstellungen öffnen ✓" (step 4, blue)
- **Skip link:** "Überspringen" on every step — closes overlay immediately, sets `welcome_seen`

## Visual Design

- Overlay: `rgba(0,0,0,0.45)` + `backdrop-filter: blur(4px)`
- Sheet: white, `border-radius: 20px 20px 0 0`, slides up from bottom
- Feature icon: 56×56px rounded square, `background: var(--surface-2)`
- Matches existing popup color palette and Geist font

## HTML

New `<div id="welcome-overlay" class="welcome-overlay hidden">` added to `popup.html` inside `#app`, after the existing panels. Contains `<div class="welcome-sheet">` with step containers.

Only the active step is visible (`display: none` on inactive steps).

## CSS

New rules in `popup.css`:
- `.welcome-overlay` — fixed overlay, backdrop, z-index above panels
- `.welcome-sheet` — bottom-anchored white sheet
- `.welcome-dots` / `.welcome-dot` / `.welcome-dot.active` — progress indicator
- `.welcome-step` — individual step container
- `.welcome-icon` — icon badge
- `.welcome-btn-next` / `.welcome-btn-skip` — action buttons
- Dark mode variants via `body.dark` selector

## JavaScript (`popup.js`)

- `checkWelcome()` — async, runs on init, reads storage, shows overlay if needed
- `showWelcomeStep(n)` — updates visible step and active dot
- `advanceWelcome()` — moves to next step or triggers final action
- `dismissWelcome(openSettings)` — sets `welcome_seen`, hides overlay, optionally opens settings panel
- All wired up via event delegation on `#welcome-overlay`

## i18n

New keys added to both `de` and `en` in `i18n.js`:

```
welcome_step1_title, welcome_step1_desc
welcome_step2_title, welcome_step2_desc
welcome_step3_title, welcome_step3_desc
welcome_step4_title, welcome_step4_desc
welcome_btn_next, welcome_btn_skip
welcome_btn_setup, welcome_btn_later
```

All elements use `data-i18n` attributes; `applyTranslations()` is called after overlay is shown.

## Out of Scope

- No "replay onboarding" button in Settings (can be added later)
- No animations beyond the existing panel transitions
- No video or interactive demos within steps
