# Agent Inline Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the separate `#agent-panel` and integrate the Agent UI as a collapsible section at the bottom of `#chat-panel`, eliminating the `#agent-btn` header icon.

**Architecture:** The `#agent-panel` div and its navigation functions (`showAgentPanel`, `showChatPanel`) are replaced by a `#agent-section` div appended to `#chat-panel`. A toggle button (`#agent-toggle`) shows/hides `#agent-section-body` via a `hidden` class. All agent logic (loop, confirm, log) is unchanged — only the DOM structure and navigation wiring changes.

**Tech Stack:** Vanilla JS, HTML, CSS (Safari Web Extension popup)

---

## Files

- Modify: `Safari AI Agent Extension/Resources/popup.html`
- Modify: `Safari AI Agent Extension/Resources/popup.css`
- Modify: `Safari AI Agent Extension/Resources/popup.js`

---

### Task 1: HTML — Remove `#agent-btn` and `#agent-panel`, add `#agent-section`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.html`

- [ ] **Step 1: Remove `#agent-btn` from the chat header**

In `popup.html`, delete lines 39–45 (the `#agent-btn` button block):

```html
<!-- DELETE this entire block: -->
<button id="agent-btn" class="icon-btn" aria-label="Seiten-Agent" title="Seiten-Agent">
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
    <path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M11 9l2 2M13 9l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
</button>
```

- [ ] **Step 2: Remove `#agent-panel` entirely**

Delete lines 231–264 (the entire `<!-- PANEL 3: Agent -->` block including the wrapping `<div id="agent-panel" ...>`).

- [ ] **Step 3: Add `#agent-section` directly after `.input-area` inside `#chat-panel`**

After the closing `</div>` of `.input-area` (currently line 127), insert:

```html
    <!-- Agent Section (inline, collapsible) -->
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
    </div>
```

- [ ] **Step 4: Verify the HTML structure looks correct**

Open `popup.html` and confirm:
- No `#agent-btn` in the header
- No `#agent-panel` div anywhere
- `#agent-section` is the last child of `#chat-panel`, after `.input-area`
- `#agent-section-body` contains `#agent-log`, `#agent-confirm-bar`, `.agent-input-row`

- [ ] **Step 5: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.html"
git commit -m "feat: replace agent-panel with inline agent-section in chat-panel"
```

---

### Task 2: CSS — Replace `#agent-panel` styles with `.agent-section` styles

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.css`

- [ ] **Step 1: Remove the `#agent-panel` rule**

Find and delete the block starting at `/* ── Agent Panel ─────────────────────────────────────────────── */` (around line 1016):

```css
/* DELETE this block: */
#agent-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
```

- [ ] **Step 2: Update `.agent-log` — remove `flex: 1`, add `max-height` + scroll**

The current `.agent-log` rule uses `flex: 1` (which made sense inside the full-height panel). Replace it:

Current:
```css
.agent-log {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
```

New:
```css
.agent-log {
  max-height: 160px;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
```

- [ ] **Step 3: Add new `.agent-section` styles**

Append after the updated `.agent-log` rule (keep the existing `.agent-log-entry`, `.agent-confirm-bar`, `.agent-input-row` etc. unchanged):

```css
/* ── Agent Section (inline collapsible) ─────────────────────── */
.agent-section {
  border-top: 1px solid var(--border-color, #e5e5e5);
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
  color: var(--text-secondary, #666);
  font-family: inherit;
}

.agent-toggle:hover {
  background: var(--surface-2, #f5f5f5);
}

.agent-chevron {
  transition: transform 0.2s ease;
  flex-shrink: 0;
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
```

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.css"
git commit -m "feat: add agent-section CSS, remove agent-panel styles"
```

---

### Task 3: JS — Replace panel-switch functions with `toggleAgentSection`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: Replace `showAgentPanel` and `showChatPanel` with `toggleAgentSection`**

Find lines 2304–2313 (the `// ── Agent Tab ──` block with `showAgentPanel` and `showChatPanel`):

```js
// ── Agent Tab ─────────────────────────────────────────────────
function showAgentPanel() {
  document.getElementById("chat-panel").classList.remove("active");
  document.getElementById("agent-panel").classList.add("active");
}

function showChatPanel() {
  document.getElementById("agent-panel").classList.remove("active");
  document.getElementById("chat-panel").classList.add("active");
}
```

Replace with:

```js
// ── Agent Section ─────────────────────────────────────────────
function openAgentSection() {
  const body = document.getElementById("agent-section-body");
  const toggle = document.getElementById("agent-toggle");
  body.classList.remove("hidden");
  toggle.setAttribute("aria-expanded", "true");
}

function toggleAgentSection() {
  const body = document.getElementById("agent-section-body");
  const toggle = document.getElementById("agent-toggle");
  const isOpen = !body.classList.contains("hidden");
  body.classList.toggle("hidden", isOpen);
  toggle.setAttribute("aria-expanded", String(!isOpen));
}
```

- [ ] **Step 2: Update `initAgentTab` — remove old listeners, add new one**

Find `function initAgentTab()` (around line 2377). Replace the first two lines of listeners:

Old:
```js
  document.getElementById("agent-btn").addEventListener("click", showAgentPanel);
  document.getElementById("agent-back-btn").addEventListener("click", () => {
    if (agentRunning) return;
    showChatPanel();
  });
```

New:
```js
  document.getElementById("agent-toggle").addEventListener("click", toggleAgentSection);
```

- [ ] **Step 3: Auto-open section when agent starts**

In `startAgentLoop()` (around line 2336), add `openAgentSection()` right after the guard checks, before clearing the log:

Find:
```js
  document.getElementById("agent-log").innerHTML = "";
  document.getElementById("agent-confirm-bar").classList.add("hidden");
  setAgentRunning(true);
```

Replace with:
```js
  openAgentSection();
  document.getElementById("agent-log").innerHTML = "";
  document.getElementById("agent-confirm-bar").classList.add("hidden");
  setAgentRunning(true);
```

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: wire toggleAgentSection, remove panel-swap navigation for agent"
```

---

### Task 4: Verify in browser / Safari

- [ ] **Step 1: Build and load the extension**

In Xcode, build the target `Safari AI Agent` (⌘B). Then enable the extension in Safari → Settings → Extensions.

- [ ] **Step 2: Open the popup and verify collapsed state**

- Chat panel shows normally
- No agent icon in the header
- At the bottom: a thin `Agent ▾` toggle strip is visible
- Agent body is hidden

- [ ] **Step 3: Click the toggle**

- `#agent-section-body` expands (task input, start button visible)
- Chevron rotates 180°
- Click again → collapses

- [ ] **Step 4: Start an agent task**

- Type a task, click Starten
- Agent section auto-expands (if not already open)
- Log entries appear in the log area
- Stop button appears, Start button hides

- [ ] **Step 5: Verify settings panel still works**

- Settings icon opens settings panel (slide animation)
- Back button returns to chat panel
- Agent section state is preserved

- [ ] **Step 6: Final commit if any minor fixes were made**

```bash
git add -p
git commit -m "fix: agent inline section polish"
```
