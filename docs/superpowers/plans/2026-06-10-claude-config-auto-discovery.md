# Claude Config Auto-Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Safari Extension liest API-Key, Base-URL und Modell automatisch aus `~/.claude/settings.json` über die Swift Host-App, mit manuellem Fallback.

**Architecture:** Die Swift Host-App liest das Dateisystem und antwortet auf eine `getAIConfig` Message von der Extension. Die Extension fragt bei jedem Popup-Open an und verwendet auto-detected Werte mit Vorrang vor manuell gespeicherten. Die Settings-UI zeigt einen Badge wenn auto-detected.

**Tech Stack:** Swift (FileManager, JSONSerialization), JavaScript (browser.runtime.sendMessage), Safari Web Extension APIs

---

## File Map

| Datei | Änderung |
|-------|----------|
| `Safari AI Agent Extension/SafariWebExtensionHandler.swift` | `getAIConfig` Message-Handler ergänzen |
| `Safari AI Agent Extension/ClaudeConfigReader.swift` | Neue Datei — liest `~/.claude/settings.json` |
| `Safari AI Agent Extension/Resources/popup.js` | `loadAIConfig()` hinzufügen, `init()` anpassen |
| `Safari AI Agent Extension/Resources/popup.html` | Badge-Element in Settings-Panel ergänzen |

---

## Task 1: `ClaudeConfigReader.swift` erstellen

**Files:**
- Create: `Safari AI Agent Extension/ClaudeConfigReader.swift`

- [ ] **Step 1: Datei erstellen**

Neue Datei `Safari AI Agent Extension/ClaudeConfigReader.swift` mit folgendem Inhalt:

```swift
import Foundation

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
              let apiKey = env["ANTHROPIC_AUTH_TOKEN"],
              !apiKey.isEmpty
        else { return nil }

        return ClaudeConfig(
            apiKey: apiKey,
            baseUrl: env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com/v1/messages",
            model: env["ANTHROPIC_MODEL"] ?? "claude-sonnet-latest"
        )
    }
}
```

- [ ] **Step 2: Datei zum Xcode-Target hinzufügen**

In Xcode: Rechtsklick auf `Safari AI Agent Extension` Gruppe → "Add Files to…" → `ClaudeConfigReader.swift` auswählen. Sicherstellen dass Target `Safari AI Agent Extension` angehakt ist.

Alternativ via `project.pbxproj`: Die Datei muss unter dem `Safari AI Agent Extension` Target referenziert sein — Xcode macht das automatisch beim "Add Files".

- [ ] **Step 3: Build prüfen**

In Xcode: `Cmd+B` — Build muss fehlerfrei durchlaufen.

Expected: `Build Succeeded`

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/ClaudeConfigReader.swift"
git add "Safari AI Agent.xcodeproj/project.pbxproj"
git commit -m "feat: add ClaudeConfigReader to read ~/.claude/settings.json"
```

---

## Task 2: `SafariWebExtensionHandler.swift` — `getAIConfig` Handler

**Files:**
- Modify: `Safari AI Agent Extension/SafariWebExtensionHandler.swift`

Aktueller Stand: Die `beginRequest` Methode echot alle Messages zurück:
```swift
response.userInfo = [ SFExtensionMessageKey: [ "echo": message ] ]
```

- [ ] **Step 1: Handler einbauen**

`SafariWebExtensionHandler.swift` ersetzen mit:

```swift
import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(.default, "Received message from browser.runtime.sendMessage: %@ (profile: %@)", String(describing: message), profile?.uuidString ?? "none")

        let responsePayload: [String: Any]

        if let dict = message as? [String: Any],
           let type = dict["type"] as? String,
           type == "getAIConfig" {
            if let config = ClaudeConfigReader.read() {
                responsePayload = [
                    "apiKey":  config.apiKey,
                    "baseUrl": config.baseUrl,
                    "model":   config.model,
                    "source":  "claude-config"
                ]
            } else {
                responsePayload = [
                    "apiKey":  "",
                    "baseUrl": "https://api.anthropic.com/v1/messages",
                    "model":   "claude-sonnet-latest",
                    "source":  "not-found"
                ]
            }
        } else {
            responsePayload = ["echo": message as Any]
        }

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: responsePayload]
        } else {
            response.userInfo = ["message": responsePayload]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

}
```

- [ ] **Step 2: Build prüfen**

In Xcode: `Cmd+B`

Expected: `Build Succeeded`

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/SafariWebExtensionHandler.swift"
git commit -m "feat: handle getAIConfig message in SafariWebExtensionHandler"
```

---

## Task 3: `popup.js` — `loadAIConfig()` und `init()` anpassen

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: `loadAIConfig()` nach `loadSettings()` einfügen**

In `popup.js` nach Zeile 65 (nach der `saveSettings` Funktion, vor `loadHistory`) einfügen:

```javascript
// ── Claude Config Auto-Discovery ──────────────────────────────
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
    // Native messaging fehlgeschlagen — Fallback zu gespeicherten Werten
  }

  // Fallback: manuell gespeicherte Werte
  const stored = await loadSettings();
  return {
    apiKey:       stored.apiKey  ?? "",
    baseUrl:      stored.baseUrl ?? "https://api.anthropic.com/v1/messages",
    model:        stored.model   ?? "claude-sonnet-latest",
    autoDetected: false
  };
}
```

- [ ] **Step 2: `init()` anpassen — `loadAIConfig()` statt `loadSettings()`**

In `init()` (aktuell Zeile 1228–1229):

Ersetze:
```javascript
async function init() {
  settings = await loadSettings();
```

Mit:
```javascript
async function init() {
  const aiConfig = await loadAIConfig();
  settings = await loadSettings();

  // Auto-detected Werte überschreiben manuelle (auto hat Vorrang)
  if (aiConfig.autoDetected) {
    settings.apiKey = aiConfig.apiKey;
    settings.baseUrl = aiConfig.baseUrl;
    settings.model = aiConfig.model;
    settings.provider = "anthropic"; // ~/.claude/ ist immer Anthropic
  }

  // Badge-Status in UI-State merken
  settings._autoDetected = aiConfig.autoDetected;
```

- [ ] **Step 3: `loadSettingsIntoUI()` — Badge ein-/ausblenden**

In `loadSettingsIntoUI()` (aktuell Zeile 195) am Ende der Funktion ergänzen:

Ersetze:
```javascript
function loadSettingsIntoUI() {
  document.getElementById("provider-select").value = settings.provider;
  document.getElementById("api-key-input").value = settings.apiKey;
  const defaultBaseUrl = PROVIDERS[settings.provider]?.baseUrl ?? "";
  document.getElementById("base-url-input").value = settings.provider === "hyperspace" ? defaultBaseUrl : (settings.baseUrl || defaultBaseUrl);
  document.getElementById("system-prompt-input").value = settings.systemPrompt;
  updateBaseUrlVisibility(settings.provider);
  populateModelDropdown(settings.provider);  // async, fire-and-forget — handles model + custom input restore internally
}
```

Mit:
```javascript
function loadSettingsIntoUI() {
  document.getElementById("provider-select").value = settings.provider;
  document.getElementById("api-key-input").value = settings.apiKey;
  const defaultBaseUrl = PROVIDERS[settings.provider]?.baseUrl ?? "";
  document.getElementById("base-url-input").value = settings.provider === "hyperspace" ? defaultBaseUrl : (settings.baseUrl || defaultBaseUrl);
  document.getElementById("system-prompt-input").value = settings.systemPrompt;
  updateBaseUrlVisibility(settings.provider);
  populateModelDropdown(settings.provider);

  // Badge + readonly Felder wenn auto-detected
  const badge = document.getElementById("claude-config-badge");
  const apiKeyInput = document.getElementById("api-key-input");
  const baseUrlInput = document.getElementById("base-url-input");
  const providerSelect = document.getElementById("provider-select");
  const modelSelect = document.getElementById("model-select");

  if (settings._autoDetected) {
    badge.style.display = "flex";
    apiKeyInput.readOnly = true;
    baseUrlInput.readOnly = true;
    providerSelect.disabled = true;
    modelSelect.disabled = true;
  } else {
    badge.style.display = "none";
    apiKeyInput.readOnly = false;
    baseUrlInput.readOnly = false;
    providerSelect.disabled = false;
    modelSelect.disabled = false;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: add loadAIConfig() with auto-discovery from ~/.claude via Swift"
```

---

## Task 4: `popup.html` — Badge-Element ergänzen

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.html`

- [ ] **Step 1: Badge-Element in Settings-Panel einfügen**

In `popup.html` nach Zeile 90 (nach `<div class="settings-scroll">`, vor der ersten `<section>`):

```html
<!-- Auto-Discovery Badge -->
<div id="claude-config-badge" class="claude-config-badge" style="display:none">
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 1l1.8 3.6L14 5.5l-3 2.9.7 4.1L8 10.5l-3.7 2 .7-4.1-3-2.9 4.2-.9z" fill="currentColor"/>
  </svg>
  <span>Aus Claude Code konfiguriert</span>
</div>
```

- [ ] **Step 2: Badge-Styles in `popup.css` ergänzen**

Am Ende von `popup.css` anhängen:

```css
.claude-config-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 16px 0;
  padding: 8px 12px;
  background: rgba(var(--accent-rgb, 214, 93, 65), 0.1);
  border: 1px solid rgba(var(--accent-rgb, 214, 93, 65), 0.25);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary, #888);
}

.claude-config-badge svg {
  color: var(--accent, #d65d41);
  flex-shrink: 0;
}
```

- [ ] **Step 3: Visuell prüfen**

Extension in Safari laden und Settings öffnen. Wenn `~/.claude/settings.json` mit `ANTHROPIC_AUTH_TOKEN` vorhanden: Badge erscheint, Felder sind readonly. Wenn nicht: Felder normal editierbar.

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.html"
git add "Safari AI Agent Extension/Resources/popup.css"
git commit -m "feat: add Claude Config auto-detected badge to settings UI"
```

---

## Task 5: Manuelle Fallback-Persistierung absichern

Wenn der User manuelle Werte eingibt (kein auto-detect), sollen diese in `browser.storage.local` gespeichert werden — das ist bereits der Fall durch `saveSettingsFromUI()`. Aber `saveSettingsFromUI()` muss `_autoDetected` ignorieren (nicht persistieren):

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: `saveSettingsFromUI()` anpassen**

Aktuelle `saveSettingsFromUI()` (Zeile 205–227) — `_autoDetected` darf nicht gespeichert werden. Ergänze am Ende vor dem `saveSettings(settings)` Aufruf:

```javascript
async function saveSettingsFromUI() {
  const providerId = document.getElementById("provider-select").value;
  const isCustom = providerId === "local";

  const newSettings = {
    provider: providerId,
    apiKey: document.getElementById("api-key-input").value.trim(),
    baseUrl: document.getElementById("base-url-input").value.trim(),
    model: isCustom ? "" : document.getElementById("model-select").value,
    customModel: isCustom ? document.getElementById("model-custom-input").value.trim() : "",
    systemPrompt: document.getElementById("system-prompt-input").value
    // _autoDetected wird bewusst nicht gespeichert
  };

  settings = { ...newSettings, _autoDetected: false };
  await saveSettings(newSettings); // nur newSettings ohne _autoDetected
  lastDisplayedModel = null;
  applyTheme(settings.provider, settings.model);

  const btn = document.getElementById("save-settings-btn");
  const original = btn.textContent;
  btn.textContent = "Gespeichert ✓";
  setTimeout(() => { btn.textContent = original; }, 1500);
}
```

- [ ] **Step 2: Build und Endtest**

Extension in Safari neu laden:
1. Mit `~/.claude/settings.json` (Key vorhanden): Badge erscheint, Felder readonly, Anfragen gehen durch
2. `ANTHROPIC_AUTH_TOKEN` aus settings.json entfernen / Datei umbenennen: Badge verschwindet, Felder editierbar
3. Manuellen Key eingeben + speichern: Werte bleiben beim nächsten Öffnen erhalten

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "fix: don't persist _autoDetected flag in saveSettingsFromUI"
```
