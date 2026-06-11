# Design: Agent als collapsible Section im Chat-Panel

**Datum:** 2026-06-11  
**Status:** Approved

## Ziel

Der Agent-Bereich soll direkt in das Chat-Panel integriert werden — ohne eigenes Panel, ohne eigenes Header-Icon. Stattdessen klappt eine Sektion am unteren Ende des Chat-Panels auf und zu.

## Aktuelle Struktur (Ist)

- Drei separate Panels: `#chat-panel`, `#settings-panel`, `#agent-panel`
- Navigation zum Agent über `#agent-btn` (Icon im Chat-Header)
- Rücknavigation über `#agent-back-btn` im Agent-Panel-Header
- JS: `showAgentPanel()` / `closeAgentPanel()` wechseln `active`-Klasse zwischen Panels

## Neue Struktur (Soll)

```
#chat-panel
  ├── header.panel-header          (ohne #agent-btn)
  ├── #history-dropdown
  ├── #messages.messages-list
  ├── #typing-indicator
  ├── #image-preview-wrap
  ├── .input-area
  └── #agent-section               ← NEU
        ├── #agent-toggle          ← Toggle-Header "Agent ▾"
        └── #agent-section-body    ← collapsible, anfangs hidden
              ├── #agent-log
              ├── #agent-confirm-bar
              └── .agent-input-row
```

`#agent-panel` entfällt vollständig.

## HTML-Änderungen

1. `#agent-btn` aus `#chat-panel > header` entfernen
2. `#agent-panel` (gesamtes Panel) entfernen
3. Direkt nach `.input-area` in `#chat-panel` einfügen:

```html
<div id="agent-section" class="agent-section">
  <button id="agent-toggle" class="agent-toggle" aria-expanded="false">
    <span>Agent</span>
    <svg class="agent-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  <div id="agent-section-body" class="agent-section-body hidden">
    <div id="agent-log" class="agent-log" role="log" aria-live="polite"></div>
    <div id="agent-confirm-bar" class="agent-confirm-bar hidden">
      <p id="agent-confirm-text" class="agent-confirm-text"></p>
      <div class="agent-confirm-actions">
        <button id="agent-confirm-yes" class="agent-confirm-btn agent-confirm-yes">Ausführen</button>
        <button id="agent-confirm-no"  class="agent-confirm-btn agent-confirm-no">Abbrechen</button>
      </div>
    </div>
    <div class="agent-input-row">
      <textarea id="agent-task-input" class="agent-task-input"
        placeholder="Aufgabe beschreiben, z.B. „Melde mich mit user@example.com an"" rows="2"></textarea>
      <div class="agent-input-actions">
        <button id="agent-start-btn" class="agent-start-btn">Starten</button>
        <button id="agent-stop-btn"  class="agent-stop-btn hidden">Stop</button>
      </div>
    </div>
  </div>
</div>
```

## CSS-Änderungen

- `#agent-panel`-Stile entfernen (waren separate Panel-Positionierung)
- Neue Klassen:

```css
.agent-section {
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.agent-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
}

.agent-toggle:hover {
  background: var(--surface-2);
}

.agent-chevron {
  transition: transform 0.2s ease;
}

.agent-toggle[aria-expanded="true"] .agent-chevron {
  transform: rotate(180deg);
}

.agent-section-body {
  overflow: hidden;
}

.agent-section-body.hidden {
  display: none;
}

/* agent-log bekommt max-height + scroll */
.agent-log {
  max-height: 160px;
  overflow-y: auto;
}
```

## JS-Änderungen

### Entfernen
- `showAgentPanel()` / `closeAgentPanel()` (oder stark vereinfachen)
- `agent-btn` Event-Listener
- `agent-back-btn` Event-Listener
- Alle `classList.add/remove('active')` für `#agent-panel`

### Hinzufügen
- `toggleAgentSection()` — klappt `#agent-section-body` auf/zu, setzt `aria-expanded`
- Event-Listener auf `#agent-toggle`

```js
function toggleAgentSection() {
  const body = document.getElementById("agent-section-body");
  const toggle = document.getElementById("agent-toggle");
  const isOpen = !body.classList.contains("hidden");
  body.classList.toggle("hidden", isOpen);
  toggle.setAttribute("aria-expanded", String(!isOpen));
}

document.getElementById("agent-toggle").addEventListener("click", toggleAgentSection);
```

### Anpassen
- Überall wo Agent-Panel per `showAgentPanel()` geöffnet wurde (z.B. beim Agent-Start), stattdessen Section aufklappen: `document.getElementById("agent-section-body").classList.remove("hidden")`

## Was entfällt

| Element | Grund |
|---|---|
| `#agent-btn` (Header-Icon) | Kein eigener Einstiegspunkt mehr nötig |
| `#agent-back-btn` | Kein Panel-Wechsel mehr |
| `#agent-panel` | Durch `#agent-section` ersetzt |
| `showAgentPanel()` / `closeAgentPanel()` | Durch `toggleAgentSection()` ersetzt |
| Panel-Slide-Animationen für Agent | Nur noch Collapse-Animation |

## Nicht geändert

- Settings-Panel bleibt als separates Panel (Slide-Navigation)
- Alle Agent-Funktions-Logik (Loop, Confirm, Log) bleibt unverändert
- CSS für `.agent-log-entry`, `.agent-confirm-bar`, `.agent-input-row`, etc. bleibt
