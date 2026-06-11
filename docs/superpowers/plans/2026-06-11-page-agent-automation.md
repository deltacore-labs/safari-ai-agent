# Page Agent Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der AI Agent kann eine Webseite selbst bedienen (klicken, tippen, scrollen etc.) während der Nutzer live über Highlights auf der Seite und ein Log im Popup sieht was passiert.

**Architecture:** ReAct-Loop: background.js orchestriert — es holt Screenshot + interaktives DOM von content.js, schickt beides zusammen mit der Aufgabe an die AI, führt die zurückgegebene Aktion via content.js aus, und wiederholt dies bis `done` oder ein Limit erreicht ist. content.js führt Aktionen aus und zeigt Highlights. popup.js steuert den neuen "Agent"-Tab mit Input, Log und Stop-Button.

**Tech Stack:** Browser Extension APIs (MV3), `browser.tabs.captureVisibleTab` (Screenshot), `browser.scripting.executeScript` (DOM-Extraktion & Aktionen), bestehende AI-Provider-Aufrufe (Anthropic/OpenAI/Gemini)

---

## File Map

| Datei | Was ändert sich |
|-------|-----------------|
| `Safari AI Agent Extension/Resources/content.js` | Neu: `AGENT_DOM`, `AGENT_ACTION`, `AGENT_HIGHLIGHT` Message-Handler |
| `Safari AI Agent Extension/Resources/background.js` | Neu: `AGENT_START`, `AGENT_STOP` Handler + ReAct-Loop + Screenshot |
| `Safari AI Agent Extension/Resources/popup.js` | Neu: Agent-Tab-State, `startAgentLoop()`, `stopAgentLoop()`, Log-Render |
| `Safari AI Agent Extension/Resources/popup.html` | Neu: Agent-Tab-Button + Agent-Panel HTML |
| `Safari AI Agent Extension/Resources/popup.css` | Neu: Agent-Tab, Log-Styles, Highlight-Styles |

---

## Task 1: content.js — DOM-Extraktion für interaktive Elemente

**Files:**
- Modify: `Safari AI Agent Extension/Resources/content.js`

- [ ] **Step 1: Bestehenden Code lesen**

Aktuell hat content.js nur einen `EXTRACT_DOM` Handler der `innerText` zurückgibt. Wir ergänzen drei neue Handler für den Agent.

- [ ] **Step 2: Komplette neue content.js schreiben**

Ersetze den gesamten Inhalt von `content.js` mit:

```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "EXTRACT_DOM") {
    const rawText = document.body?.innerText ?? "";
    const truncated = rawText.length > 50000
      ? rawText.slice(0, 50000) + "\n...[truncated]"
      : rawText;
    sendResponse({ text: truncated, title: document.title, url: window.location.href });
    return true;
  }

  if (message.action === "AGENT_DOM") {
    const elements = [];
    const selectors = "input, button, a, select, textarea, [role='button'], [role='link'], [role='checkbox'], [role='menuitem']";
    document.querySelectorAll(selectors).forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const label = el.getAttribute("aria-label")
        || el.getAttribute("placeholder")
        || el.getAttribute("title")
        || el.textContent?.trim().slice(0, 60)
        || "";
      elements.push({
        index: i,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || "",
        id: el.id || "",
        name: el.getAttribute("name") || "",
        label,
        selector: buildSelector(el)
      });
    });
    sendResponse({ elements, url: window.location.href, title: document.title });
    return true;
  }

  if (message.action === "AGENT_HIGHLIGHT") {
    const { selector, actionType } = message;
    const el = document.querySelector(selector);
    if (!el) { sendResponse({ ok: false }); return true; }
    const color = actionType === "type" ? "#f97316" : "#3b82f6";
    const label = actionType === "type" ? "Tippe…" : actionType === "click" ? "Klicke…" : actionType;
    showHighlight(el, color, label);
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === "AGENT_ACTION") {
    const { action, selector, value, direction, amount, url, ms } = message;
    (async () => {
      try {
        if (action === "click") {
          const el = document.querySelector(selector);
          if (!el) { sendResponse({ ok: false, error: `selector not found: ${selector}` }); return; }
          el.focus();
          el.click();
          sendResponse({ ok: true });
        } else if (action === "type") {
          const el = document.querySelector(selector);
          if (!el) { sendResponse({ ok: false, error: `selector not found: ${selector}` }); return; }
          el.focus();
          el.value = "";
          for (const char of String(value)) {
            el.value += char;
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
          el.dispatchEvent(new Event("change", { bubbles: true }));
          sendResponse({ ok: true });
        } else if (action === "scroll") {
          const dy = direction === "up" ? -(amount || 300) : (amount || 300);
          window.scrollBy({ top: dy, behavior: "smooth" });
          sendResponse({ ok: true });
        } else if (action === "select") {
          const el = document.querySelector(selector);
          if (!el) { sendResponse({ ok: false, error: `selector not found: ${selector}` }); return; }
          el.value = value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          sendResponse({ ok: true });
        } else if (action === "navigate") {
          const currentOrigin = window.location.origin;
          const targetUrl = new URL(url, window.location.href);
          if (targetUrl.origin !== currentOrigin) {
            sendResponse({ ok: false, error: "cross-origin navigation blocked" });
            return;
          }
          window.location.href = targetUrl.href;
          sendResponse({ ok: true });
        } else if (action === "wait") {
          await new Promise(r => setTimeout(r, Math.min(ms || 1000, 5000)));
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: `unknown action: ${action}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  return false;
});

function buildSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.getAttribute("name")) return `${el.tagName.toLowerCase()}[name="${el.getAttribute("name")}"]`;
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length === 1) {
      const parentSel = buildSelector(parent);
      return `${parentSel} > ${el.tagName.toLowerCase()}`;
    }
    const idx = siblings.indexOf(el);
    const parentSel = buildSelector(parent);
    return `${parentSel} > ${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
  }
  return el.tagName.toLowerCase();
}

function showHighlight(el, color, label) {
  const existing = document.getElementById("__agent-highlight__");
  if (existing) existing.remove();

  const rect = el.getBoundingClientRect();
  const div = document.createElement("div");
  div.id = "__agent-highlight__";
  div.style.cssText = `
    position: fixed;
    top: ${rect.top - 2}px;
    left: ${rect.left - 2}px;
    width: ${rect.width + 4}px;
    height: ${rect.height + 4}px;
    border: 2px solid ${color};
    border-radius: 4px;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: 0 0 0 3px ${color}33;
    transition: opacity 0.3s;
  `;

  const badge = document.createElement("span");
  badge.textContent = label;
  badge.style.cssText = `
    position: absolute;
    top: -22px;
    left: 0;
    background: ${color};
    color: white;
    font-size: 11px;
    font-family: sans-serif;
    padding: 2px 6px;
    border-radius: 3px;
    white-space: nowrap;
  `;
  div.appendChild(badge);
  document.body.appendChild(div);

  setTimeout(() => {
    div.style.opacity = "0";
    setTimeout(() => div.remove(), 300);
  }, 1200);
}
```

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/content.js"
git commit -m "feat(agent): add AGENT_DOM, AGENT_ACTION, AGENT_HIGHLIGHT handlers to content.js"
```

---

## Task 2: background.js — ReAct-Loop & Screenshot

**Files:**
- Modify: `Safari AI Agent Extension/Resources/background.js`

- [ ] **Step 1: Aktuelle background.js lesen**

background.js hat aktuell: Context-Menu-Handlers und einen `getAIConfig` Handler. Wir ergänzen den Agent-Loop.

- [ ] **Step 2: Agent-Loop in background.js einfügen**

Füge NACH Zeile 37 (Ende des `contextMenus.onClicked` Listeners) folgenden Code hinzu:

```javascript
// ── Agent Loop ────────────────────────────────────────────────
let agentRunning = false;
let agentAbort = false;
const AGENT_MAX_ITERATIONS = 30;
const AGENT_ACTION_TIMEOUT_MS = 60000;

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "AGENT_START") {
    if (agentRunning) { sendResponse({ ok: false, error: "already running" }); return true; }
    agentAbort = false;
    agentRunning = true;
    runAgentLoop(message.task, message.tabId, message.providerId, message.model, message.apiKey, message.baseUrl)
      .catch(e => notifyPopup({ type: "AGENT_LOG", status: "error", text: `Fehler: ${e.message}` }))
      .finally(() => {
        agentRunning = false;
        notifyPopup({ type: "AGENT_DONE" });
      });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "AGENT_STOP") {
    agentAbort = true;
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

function notifyPopup(msg) {
  browser.runtime.sendMessage(msg).catch(() => {});
}

async function runAgentLoop(task, tabId, providerId, model, apiKey, baseUrl) {
  notifyPopup({ type: "AGENT_LOG", status: "thinking", text: "Analysiere Seite…" });

  for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
    if (agentAbort) {
      notifyPopup({ type: "AGENT_LOG", status: "info", text: "Abgebrochen." });
      return;
    }

    // 1. Screenshot
    let screenshotDataUrl = null;
    try {
      screenshotDataUrl = await browser.tabs.captureVisibleTab(null, { format: "jpeg", quality: 70 });
    } catch (e) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: `Screenshot fehlgeschlagen: ${e.message}` });
    }

    // 2. DOM
    let domElements = [];
    let pageUrl = "";
    try {
      const domResult = await browser.tabs.sendMessage(tabId, { action: "AGENT_DOM" });
      domElements = domResult?.elements ?? [];
      pageUrl = domResult?.url ?? "";
    } catch (e) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: `DOM-Extraktion fehlgeschlagen: ${e.message}` });
    }

    // 3. AI-Call
    const aiResponse = await callAgentAI({
      task, domElements, pageUrl, iteration: i,
      screenshotDataUrl, providerId, model, apiKey, baseUrl
    });

    if (!aiResponse) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: "AI-Antwort konnte nicht gelesen werden." });
      return;
    }

    const { action, selector, value, direction, amount, url, ms, summary, reason } = aiResponse;
    const logText = buildLogText(aiResponse);

    // 4. Kritische Aktion? → Bestätigung anfordern
    if (action === "submit" || (action === "click" && isSubmitElement(selector, domElements))) {
      const confirmed = await requestConfirmation(logText);
      if (!confirmed) {
        notifyPopup({ type: "AGENT_LOG", status: "info", text: "Aktion abgebrochen (nicht bestätigt)." });
        continue;
      }
    }

    notifyPopup({ type: "AGENT_LOG", status: "running", text: logText });

    if (action === "done") {
      notifyPopup({ type: "AGENT_LOG", status: "success", text: `Erledigt: ${summary || "Aufgabe abgeschlossen"}` });
      return;
    }

    // 5. Highlight anzeigen
    if (selector) {
      await browser.tabs.sendMessage(tabId, { action: "AGENT_HIGHLIGHT", selector, actionType: action }).catch(() => {});
    }

    // 6. Aktion ausführen
    const actionMsg = { action, selector, value, direction, amount, url, ms };
    const actionResult = await Promise.race([
      browser.tabs.sendMessage(tabId, { action: "AGENT_ACTION", ...actionMsg }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), AGENT_ACTION_TIMEOUT_MS))
    ]).catch(e => ({ ok: false, error: e.message }));

    if (!actionResult?.ok) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: `Fehler bei "${action}": ${actionResult?.error ?? "unbekannt"}` });
    }

    // Kurz warten damit Seite reagieren kann
    await new Promise(r => setTimeout(r, 600));
  }

  notifyPopup({ type: "AGENT_LOG", status: "error", text: "Maximale Iterationen (30) erreicht." });
}

function buildLogText(aiResponse) {
  const { action, selector, value, direction, summary } = aiResponse;
  if (action === "click") return `Klicke auf ${selector}`;
  if (action === "type") return `Tippe "${value}" in ${selector}`;
  if (action === "scroll") return `Scrolle ${direction}`;
  if (action === "select") return `Wähle "${value}" in ${selector}`;
  if (action === "navigate") return `Navigiere zu ${aiResponse.url}`;
  if (action === "wait") return `Warte ${aiResponse.ms}ms…`;
  if (action === "done") return `Erledigt: ${summary || ""}`;
  return action;
}

function isSubmitElement(selector, domElements) {
  if (!selector) return false;
  const el = domElements.find(e => e.selector === selector);
  return el?.type === "submit" || el?.tag === "button" && /submit|senden|send|abschicken/i.test(el.label);
}

async function requestConfirmation(actionText) {
  return new Promise(resolve => {
    const handler = (msg) => {
      if (msg.type === "AGENT_CONFIRM_RESPONSE") {
        browser.runtime.onMessage.removeListener(handler);
        resolve(msg.confirmed);
      }
    };
    browser.runtime.onMessage.addListener(handler);
    notifyPopup({ type: "AGENT_CONFIRM_REQUEST", actionText });
    setTimeout(() => { browser.runtime.onMessage.removeListener(handler); resolve(false); }, 30000);
  });
}

async function callAgentAI({ task, domElements, pageUrl, iteration, screenshotDataUrl, providerId, model, apiKey, baseUrl }) {
  const domSummary = domElements.slice(0, 80).map(e =>
    `[${e.index}] ${e.tag}${e.type ? `[type=${e.type}]` : ""}${e.id ? `#${e.id}` : ""}${e.label ? ` "${e.label}"` : ""} → ${e.selector}`
  ).join("\n");

  const systemPrompt = `Du bist ein Web-Automatisierungs-Agent. Du erhältst einen Screenshot und eine Liste interaktiver Elemente der aktuellen Seite sowie eine Aufgabe.
Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Text drumherum) mit genau einem der folgenden Formate:
- {"action":"click","selector":"<css-selektor>","reason":"<warum>"}
- {"action":"type","selector":"<css-selektor>","value":"<text>","reason":"<warum>"}
- {"action":"scroll","direction":"down"|"up","amount":300,"reason":"<warum>"}
- {"action":"select","selector":"<css-selektor>","value":"<option-value>","reason":"<warum>"}
- {"action":"navigate","url":"<url>","reason":"<warum>"}
- {"action":"wait","ms":1000,"reason":"<warum>"}
- {"action":"done","summary":"<was wurde erreicht>"}
Verwende nur Selektoren aus der DOM-Liste. Wenn du unsicher bist, wähle "scroll" oder "wait".`;

  const userContent = [];

  if (screenshotDataUrl) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: screenshotDataUrl.replace("data:image/jpeg;base64,", "") }
    });
  }

  userContent.push({
    type: "text",
    text: `Aufgabe: ${task}\nIteration: ${iteration + 1}/30\nURL: ${pageUrl}\n\nInteraktive Elemente:\n${domSummary || "(keine gefunden)"}`
  });

  try {
    if (providerId === "anthropic") {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: 256,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }]
        })
      });
      const data = await resp.json();
      const text = data?.content?.[0]?.text ?? "";
      return JSON.parse(text);
    } else {
      // OpenAI-compatible (openai, hyperspace, local)
      const messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: screenshotDataUrl ? [
            { type: "image_url", image_url: { url: screenshotDataUrl } },
            { type: "text", text: `Aufgabe: ${task}\nIteration: ${iteration + 1}/30\nURL: ${pageUrl}\n\nInteraktive Elemente:\n${domSummary || "(keine gefunden)"}` }
          ] : `Aufgabe: ${task}\nIteration: ${iteration + 1}/30\nURL: ${pageUrl}\n\nInteraktive Elemente:\n${domSummary || "(keine gefunden)"}`
        }
      ];
      const endpoint = baseUrl
        ? `${baseUrl.replace(/\/$/, "")}/chat/completions`
        : "https://api.openai.com/v1/chat/completions";
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model, max_tokens: 256, messages })
      });
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content ?? "";
      return JSON.parse(text);
    }
  } catch (e) {
    return null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/background.js"
git commit -m "feat(agent): add ReAct loop orchestration to background.js"
```

---

## Task 3: popup.html — Agent-Tab hinzufügen

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.html`

- [ ] **Step 1: popup.html lesen** (erste 120 Zeilen sind die relevanten)

- [ ] **Step 2: Agent-Panel einfügen**

Finde die Stelle nach dem schließenden `</div>` des `chat-panel` (vor dem letzten `</div>` von `#app`) und füge ein:

```html
    <!-- PANEL 2: Agent -->
    <div id="agent-panel" class="panel">
      <header class="panel-header">
        <span class="header-title">Seiten-Agent</span>
        <button id="agent-back-btn" class="icon-btn" aria-label="Zurück zum Chat" title="Zurück zum Chat">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </header>

      <div id="agent-log" class="agent-log" role="log" aria-live="polite"></div>

      <div id="agent-confirm-bar" class="agent-confirm-bar hidden">
        <p id="agent-confirm-text" class="agent-confirm-text"></p>
        <div class="agent-confirm-actions">
          <button id="agent-confirm-yes" class="agent-confirm-btn agent-confirm-yes">Ausführen</button>
          <button id="agent-confirm-no"  class="agent-confirm-btn agent-confirm-no">Abbrechen</button>
        </div>
      </div>

      <div class="agent-input-row">
        <textarea
          id="agent-task-input"
          class="agent-task-input"
          placeholder="Aufgabe beschreiben, z.B. „Melde mich mit user@example.com an""
          rows="2"
        ></textarea>
        <div class="agent-input-actions">
          <button id="agent-start-btn" class="agent-start-btn">Starten</button>
          <button id="agent-stop-btn"  class="agent-stop-btn hidden">Stop</button>
        </div>
      </div>
    </div>
```

Außerdem: Füge im `chat-panel` Header (nach dem `settings-btn` Button) einen Agent-Button ein:

```html
          <button id="agent-btn" class="icon-btn" aria-label="Seiten-Agent" title="Seiten-Agent">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M11 9l2 2M13 9l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
```

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.html"
git commit -m "feat(agent): add agent panel and nav button to popup.html"
```

---

## Task 4: popup.css — Agent-Styles hinzufügen

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.css`

- [ ] **Step 1: Ans Ende von popup.css folgendes hinzufügen**

```css
/* ── Agent Panel ─────────────────────────────────────────────── */
.agent-log {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.agent-log-entry {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.4;
  color: var(--text-primary, #1a1a1a);
}

.agent-log-entry .agent-log-icon {
  flex-shrink: 0;
  font-size: 14px;
  margin-top: 1px;
}

.agent-log-entry.status-thinking .agent-log-icon::before { content: "⏳"; }
.agent-log-entry.status-running  .agent-log-icon::before { content: "▶"; }
.agent-log-entry.status-success  .agent-log-icon::before { content: "✅"; }
.agent-log-entry.status-error    .agent-log-icon::before { content: "❌"; }
.agent-log-entry.status-info     .agent-log-icon::before { content: "ℹ"; }

.agent-confirm-bar {
  background: var(--surface-2, #f5f5f5);
  border-top: 1px solid var(--border, #e0e0e0);
  padding: 10px 14px;
}

.agent-confirm-bar.hidden { display: none; }

.agent-confirm-text {
  font-size: 13px;
  margin: 0 0 8px;
  color: var(--text-primary, #1a1a1a);
}

.agent-confirm-actions {
  display: flex;
  gap: 8px;
}

.agent-confirm-btn {
  flex: 1;
  padding: 6px 0;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.agent-confirm-yes { background: #3b82f6; color: white; }
.agent-confirm-yes:hover { background: #2563eb; }
.agent-confirm-no  { background: var(--surface-3, #e5e5e5); color: var(--text-primary, #1a1a1a); }
.agent-confirm-no:hover  { background: var(--surface-4, #d5d5d5); }

.agent-input-row {
  border-top: 1px solid var(--border, #e0e0e0);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-task-input {
  width: 100%;
  resize: none;
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  background: var(--surface-1, #fff);
  color: var(--text-primary, #1a1a1a);
  box-sizing: border-box;
  outline: none;
}

.agent-task-input:focus { border-color: #3b82f6; }

.agent-input-actions {
  display: flex;
  gap: 8px;
}

.agent-start-btn {
  flex: 1;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 0;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.agent-start-btn:hover { background: #2563eb; }
.agent-start-btn:disabled { background: #93c5fd; cursor: not-allowed; }

.agent-stop-btn {
  flex: 1;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 0;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.agent-stop-btn:hover { background: #dc2626; }
.agent-stop-btn.hidden { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.css"
git commit -m "feat(agent): add agent panel CSS styles"
```

---

## Task 5: popup.js — Agent-Tab-Logik

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: State-Variable am Anfang ergänzen**

Finde den Block `// ── Module State ──` (Zeile ~49) und füge nach `let pendingImageData = null;` ein:

```javascript
let agentRunning = false;
```

- [ ] **Step 2: Agent-Tab-Navigation und Log-Render als neue Funktion einfügen**

Füge am Ende von popup.js, VOR der letzten Zeile `document.addEventListener("DOMContentLoaded", init);`, folgenden Block ein:

```javascript
// ── Agent Tab ─────────────────────────────────────────────────
function showAgentPanel() {
  document.getElementById("chat-panel").classList.remove("active");
  document.getElementById("agent-panel").classList.add("active");
}

function showChatPanel() {
  document.getElementById("agent-panel").classList.remove("active");
  document.getElementById("chat-panel").classList.add("active");
}

function agentLog(status, text) {
  const log = document.getElementById("agent-log");
  const entry = document.createElement("div");
  entry.className = `agent-log-entry status-${status}`;
  entry.innerHTML = `<span class="agent-log-icon"></span><span>${text}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function setAgentRunning(running) {
  agentRunning = running;
  document.getElementById("agent-start-btn").disabled = running;
  document.getElementById("agent-stop-btn").classList.toggle("hidden", !running);
  document.getElementById("agent-start-btn").classList.toggle("hidden", running);
}

async function startAgentLoop() {
  const taskInput = document.getElementById("agent-task-input");
  const task = taskInput.value.trim();
  if (!task) return;

  document.getElementById("agent-log").innerHTML = "";
  setAgentRunning(true);

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs?.[0]?.id;
  if (!tabId) { agentLog("error", "Kein aktiver Tab gefunden."); setAgentRunning(false); return; }

  const response = await browser.runtime.sendMessage({
    type: "AGENT_START",
    task,
    tabId,
    providerId: settings.provider,
    model: settings.model || settings.customModel,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl
  });

  if (!response?.ok) {
    agentLog("error", response?.error ?? "Konnte Agent nicht starten.");
    setAgentRunning(false);
  }
}

function stopAgentLoop() {
  browser.runtime.sendMessage({ type: "AGENT_STOP" });
}

function initAgentTab() {
  document.getElementById("agent-btn").addEventListener("click", showAgentPanel);
  document.getElementById("agent-back-btn").addEventListener("click", showChatPanel);
  document.getElementById("agent-start-btn").addEventListener("click", startAgentLoop);
  document.getElementById("agent-stop-btn").addEventListener("click", stopAgentLoop);

  document.getElementById("agent-confirm-yes").addEventListener("click", () => {
    document.getElementById("agent-confirm-bar").classList.add("hidden");
    browser.runtime.sendMessage({ type: "AGENT_CONFIRM_RESPONSE", confirmed: true });
  });

  document.getElementById("agent-confirm-no").addEventListener("click", () => {
    document.getElementById("agent-confirm-bar").classList.add("hidden");
    browser.runtime.sendMessage({ type: "AGENT_CONFIRM_RESPONSE", confirmed: false });
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "AGENT_LOG") agentLog(msg.status, msg.text);
    if (msg.type === "AGENT_DONE") setAgentRunning(false);
    if (msg.type === "AGENT_CONFIRM_REQUEST") {
      document.getElementById("agent-confirm-text").textContent = `Bestätigen: ${msg.actionText}`;
      document.getElementById("agent-confirm-bar").classList.remove("hidden");
    }
  });
}
```

- [ ] **Step 3: `initAgentTab()` in `init()` aufrufen**

Finde am Ende der `init()` Funktion (kurz vor der schließenden `}`) die letzte Zeile `browser.runtime.onMessage.addListener(...)` und rufe danach `initAgentTab();` auf.

Der Bereich sieht so aus (um ~Zeile 2005):
```javascript
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CONTEXT_MENU_TEXT" && msg.prompt) {
      document.getElementById("user-input").value = msg.prompt;
      document.getElementById("send-btn").disabled = false;
      document.getElementById("user-input").focus();
    }
  });
  // HIER EINFÜGEN:
  initAgentTab();
}
```

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat(agent): add agent tab logic to popup.js (startAgentLoop, log, confirm)"
```

---

## Task 6: Manueller Test & Verifikation

- [ ] **Step 1: Extension in Xcode bauen**

Xcode öffnen, Projekt `Safari AI Agent` wählen, Build (⌘B). Keine Compile-Fehler erwartet (JS hat keine Build-Step — aber Xcode kopiert die Ressourcen).

- [ ] **Step 2: Extension in Safari aktivieren**

Safari → Einstellungen → Erweiterungen → "Safari AI Agent" aktivieren.

- [ ] **Step 3: Basis-Flow testen**

1. Öffne eine Testseite (z.B. `https://example.com`)
2. Öffne das Popup
3. Klicke auf den Agent-Button (Person-Icon) im Header
4. Agent-Panel erscheint ✓
5. Gib Aufgabe ein: "Klicke auf den ersten Link"
6. Starte — Log-Einträge erscheinen ✓
7. Auf der Seite erscheint kurz ein blauer Rahmen um den Link ✓
8. "Stop"-Button erscheint während Agent läuft ✓

- [ ] **Step 4: Fehlerfall testen**

1. Gib Aufgabe ein auf einer Seite ohne interaktive Elemente
2. Agent soll nach max. 30 Iterationen mit Fehlermeldung abbrechen ✓

- [ ] **Step 5: Abbruch testen**

1. Aufgabe starten
2. Sofort "Stop" klicken
3. Log zeigt "Abgebrochen." ✓

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: page agent automation — ReAct loop with visual highlights and log"
```
