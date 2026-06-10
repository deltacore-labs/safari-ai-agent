# Design: Claude Config Auto-Discovery

**Date:** 2026-06-10  
**Status:** Approved

## Ziel

Die Safari Extension soll AI-Verbindungsdaten (API-Key, Proxy-URL, Modell) automatisch aus `~/.claude/settings.json` lesen, ohne dass der User etwas manuell eingeben muss. Manuelles Eingeben bleibt als Fallback erhalten.

## Architektur

Die Extension läuft in einer Browser-Sandbox und kann nicht direkt auf das Dateisystem zugreifen. Die native Swift Host-App übernimmt den Dateisystem-Zugriff und gibt die Daten per Native Messaging an die Extension weiter.

```
Extension (JS)          Swift Host App              Dateisystem
     │                       │                           │
     │──sendMessage()────────▶│                           │
     │   {type:"getAIConfig"} │──read ~/.claude/──────────▶│
     │                        │  settings.json             │
     │                        │◀──────────────────────────│
     │◀──{apiKey, baseUrl,    │
     │    model, source}──────│
     │
     [source === "claude-config"]    [source === "not-found"]
     → auto-detected verwenden        → manuelles Eingabefeld anzeigen
```

**Zeitpunkt:** Config wird bei jedem Popup-Open neu angefragt, damit Änderungen in `~/.claude/` sofort wirken. Kein Caching in `browser.storage`.

## Was aus `~/.claude/settings.json` gelesen wird

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "...",       → apiKey
    "ANTHROPIC_BASE_URL": "http://...",  → baseUrl
    "ANTHROPIC_MODEL": "claude-sonnet-latest" → model
  }
}
```

**Defaults wenn Felder fehlen:**
- `baseUrl`: `"https://api.anthropic.com/v1/messages"`
- `model`: `"claude-sonnet-latest"`
- Kein `apiKey` → `source: "not-found"` → Fallback-UI

## Swift-Implementierung

### Neue Datei: `ClaudeConfigReader.swift`

```swift
struct ClaudeConfig {
    let apiKey: String
    let baseUrl: String
    let model: String
}

struct ClaudeConfigReader {
    static func read() -> ClaudeConfig? {
        let path = FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/settings.json")

        guard let data = try? Data(contentsOf: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let env = json["env"] as? [String: String],
              let apiKey = env["ANTHROPIC_AUTH_TOKEN"], !apiKey.isEmpty
        else { return nil }

        return ClaudeConfig(
            apiKey: apiKey,
            baseUrl: env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com/v1/messages",
            model: env["ANTHROPIC_MODEL"] ?? "claude-sonnet-latest"
        )
    }
}
```

### Änderung: `SafariWebExtensionHandler.swift`

Neuer Message-Handler für `"getAIConfig"`:

```swift
case "getAIConfig":
    let config = ClaudeConfigReader.read()
    reply([
        "apiKey":  config?.apiKey  ?? "",
        "baseUrl": config?.baseUrl ?? "https://api.anthropic.com/v1/messages",
        "model":   config?.model   ?? "claude-sonnet-latest",
        "source":  config != nil ? "claude-config" : "not-found"
    ])
```

## JavaScript-Implementierung

### Neue Funktion: `loadAIConfig()` in `popup.js`

```javascript
async function loadAIConfig() {
    try {
        const response = await browser.runtime.sendMessage({ type: "getAIConfig" });

        if (response?.source === "claude-config" && response.apiKey) {
            return {
                apiKey:       response.apiKey,
                baseUrl:      response.baseUrl,
                model:        response.model,
                autoDetected: true
            };
        }
    } catch {
        // Native messaging fehlgeschlagen — Fallback
    }

    // Fallback: manuell gespeicherte Werte aus browser.storage.local
    const stored = await browser.storage.local.get(["apiKey", "baseUrl", "model"]);
    return {
        apiKey:       stored.apiKey  ?? "",
        baseUrl:      stored.baseUrl ?? "https://api.anthropic.com/v1/messages",
        model:        stored.model   ?? "claude-sonnet-latest",
        autoDetected: false
    };
}
```

### Settings-UI Anpassung

- Wenn `autoDetected === true`: Eingabefelder als readonly anzeigen + Badge **"Aus Claude Code konfiguriert"**
- Wenn `autoDetected === false`: Normale Eingabefelder, User kann manuell eingeben und Werte werden in `browser.storage.local` gespeichert
- Manuell gespeicherte Werte werden bei jedem Start mit den auto-detected Werten überschrieben (auto hat Vorrang)

## Fehlerbehandlung

| Situation | Verhalten |
|-----------|-----------|
| `~/.claude/settings.json` nicht vorhanden | `source: "not-found"` → Fallback-UI |
| JSON Parse-Fehler | Swift gibt `nil` zurück → `source: "not-found"` |
| `ANTHROPIC_AUTH_TOKEN` fehlt/leer | `source: "not-found"` → Fallback-UI |
| `browser.runtime.sendMessage` schlägt fehl | JS catch → Fallback aus `browser.storage.local` |
| Fallback ohne gespeicherte Werte | Leere Eingabefelder, User muss manuell eingeben |

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `SafariWebExtensionHandler.swift` | Neuer `getAIConfig` Message-Handler |
| `ClaudeConfigReader.swift` | Neue Datei — liest `~/.claude/settings.json` |
| `Safari AI Agent Extension/Resources/popup.js` | `loadAIConfig()` ersetzt bisherige Settings-Initialisierung |
| `Safari AI Agent Extension/Resources/popup.html` | Badge "Aus Claude Code konfiguriert" |

## Nicht in Scope

- Änderungen an der AI-Kommunikation selbst (Streaming, Tool-Use, etc.)
- Schreiben in `~/.claude/settings.json`
- Unterstützung anderer Config-Quellen (Keychain, etc.)
