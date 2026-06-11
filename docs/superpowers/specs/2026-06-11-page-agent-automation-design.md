# Page Agent Automation — Design Spec

**Date:** 2026-06-11  
**Feature:** AI-gesteuerte Seitenbedienung mit visuellem Feedback

---

## Überblick

Der AI Agent kann eine Webseite selbst bedienen — klicken, tippen, scrollen — während der Nutzer live sieht was passiert. Der Agent arbeitet in einem iterativen ReAct-Loop: nach jeder Aktion schaut er neu auf die Seite und entscheidet die nächste Aktion.

---

## Architektur & Datenfluss

```
User (Popup)
    │ Aufgabe als Text eingeben
    ▼
background.js  ◄──────────────────────────────────┐
    │                                              │
    │ 1. Screenshot + DOM von content.js holen     │
    │ 2. Sende Screenshot + DOM + Aufgabe an AI    │
    ▼                                              │
AI Model                                           │
    │ Gibt zurück: { action, selector, value }     │
    ▼                                              │
background.js                                      │
    │ Sendet Aktion an content.js                  │
    ▼                                              │
content.js                                         │
    │ - Hebt Element visuell hervor (Highlight)    │
    │ - Führt Aktion aus (click/type/scroll/...)   │
    │ - Meldet Ergebnis zurück                     │
    ▼                                              │
background.js                                      │
    │ Loggt Schritt im Popup                       │
    └──► Neuer Screenshot + DOM → zurück zum AI ──┘
```

Loop endet wenn AI `{ action: "done" }` zurückgibt, der Nutzer abbricht, oder ein Fehler/Limit erreicht wird.

---

## Seitenerkennung

Der Agent erhält bei jedem Schritt:
- **Screenshot** der aktuellen Seite (für visuellen Kontext, Vision-fähige Modelle)
- **Vereinfachtes DOM** — interaktive Elemente mit Selektor, Typ, Label/Placeholder, sichtbarer Text (kein kompletter HTML-Baum)

Das DOM wird in content.js extrahiert und auf interaktive Elemente reduziert (`input`, `button`, `a`, `select`, `textarea`).

---

## Aktionen

| Aktion     | Parameter              | Beschreibung                          |
|------------|------------------------|---------------------------------------|
| `click`    | `selector`             | Element anklicken                     |
| `type`     | `selector`, `value`    | Text in Eingabefeld tippen            |
| `scroll`   | `direction`, `amount`  | Seite scrollen                        |
| `select`   | `selector`, `value`    | Dropdown-Option auswählen             |
| `navigate` | `url`                  | URL auf gleicher Domain aufrufen      |
| `wait`     | `ms`                   | Kurz warten (z.B. auf Laden)          |
| `done`     | `summary`              | Aufgabe abgeschlossen                 |

---

## Visuelles Feedback

### Highlight auf der Seite (content.js)
- Betroffenes Element bekommt kurz einen farbigen Rahmen (blau für normale Aktionen, orange für Tippen)
- Kleines Label direkt am Element: "Klicke…" / "Tippe…"
- Verschwindet nach ~1 Sekunde automatisch

### Log im Popup (background.js → popup.js)
```
⏳ Analysiere Seite...
✅ Klicke auf #login-button
✅ Tippe "max@example.com" in #email
⏳ Warte auf Seitenlade...
✅ Aufgabe abgeschlossen
```
- Jeder Schritt wird als neue Zeile angehängt
- Scrollt automatisch zum neuesten Eintrag
- "Stop"-Button bricht den Loop sofort ab

---

## Sicherheit & Grenzen

### Bestätigung vor kritischen Aktionen
- Vor `submit` und Aktionen die Daten absenden → Pause + Bestätigungsdialog im Popup
- Alle anderen Aktionen laufen ohne Unterbrechung

### Limits
- Max. **30 Loop-Iterationen** pro Aufgabe
- **60 Sekunden** Timeout pro einzelne Aktion
- Kein Zugriff auf Passwort-Manager oder gespeicherte Credentials

### Einschränkungen
- Keine Datei-Downloads oder -Uploads
- Keine neuen Tabs
- Navigation nur innerhalb der aktuellen Domain

---

## Komponenten & Änderungen

| Datei | Änderung |
|-------|----------|
| `content.js` | DOM-Extraktion, Aktionsausführung, Highlight-Overlay |
| `background.js` | ReAct-Loop-Orchestrierung, AI-Calls mit Screenshot+DOM |
| `popup.js` | Agent-Tab mit Aufgaben-Input, Log-Anzeige, Stop-Button |
| `popup.html` | Neuer "Agent"-Tab |

---

## Fehlerbehandlung

- Selektor nicht gefunden → AI bekommt Fehlermeldung + neuen Screenshot, versucht Alternative
- Aktion schlägt fehl → Fehler im Log, Loop läuft weiter (bis Max-Iterations)
- API-Fehler → Loop stoppt, Fehlermeldung im Popup
