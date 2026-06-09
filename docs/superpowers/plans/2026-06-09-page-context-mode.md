# Page Context Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary page-toggle button with a 3-state Segmented Control (Auto/Seite/Aus) and add a hybrid detection pipeline that auto-decides per message whether to include the current page in the system prompt.

**Architecture:** The existing `pageToggleEnabled` boolean is replaced by a `pageContextMode` string (`"auto"` | `"on"` | `"off"`), persisted in `browser.storage.local`. In Auto mode, `shouldIncludePageContext(text)` first runs a keyword regex; if ambiguous it fires a mini API call to the active model. `buildSystemPrompt` becomes `buildSystemPrompt(includePageContext)` — a pure function — and `sendMessage` resolves the mode before calling it.

**Tech Stack:** Vanilla JS (ES modules), Safari WebExtension APIs (`browser.storage.local`), CSS custom properties

---

### Task 1: Replace page-toggle-btn with Segmented Control in HTML

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.html:20-27`

- [ ] **Step 1: Replace the `<button id="page-toggle-btn">` block**

Replace lines 20–27 in `popup.html` (the `page-toggle-btn` button) with:

```html
<div id="page-ctx-control" class="page-ctx-control" role="group" aria-label="Seitenkontext-Modus">
  <button data-mode="auto"  class="page-ctx-btn active" title="Automatisch erkennen">Auto</button>
  <button data-mode="on"    class="page-ctx-btn"         title="Seite immer einbeziehen">Seite</button>
  <button data-mode="off"   class="page-ctx-btn"         title="Seite nie einbeziehen">Aus</button>
</div>
```

- [ ] **Step 2: Verify HTML is valid**

Open `popup.html` and confirm the three buttons are inside `.header-actions`, between the header title and the new-chat/settings buttons. There should be no remaining reference to `page-toggle-btn`.

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.html"
git commit -m "feat: replace page-toggle-btn with 3-state segmented control (HTML)"
```

---

### Task 2: Style the Segmented Control in CSS

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.css` — replace the `/* ── Page Toggle Button */` section (lines 166–186)

- [ ] **Step 1: Replace the `.toggle-btn` block with segmented control styles**

Find the block starting with `/* ── Page Toggle Button ──` and ending with the closing `}` after `.toggle-btn.active`. Replace the entire block with:

```css
/* ── Page Context Segmented Control ─────────────────────────── */
.page-ctx-control {
  display: flex;
  align-items: center;
  background: var(--color-surface-2);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-pill);
  padding: 2px;
  gap: 1px;
}

.page-ctx-btn {
  height: 24px;
  padding: 0 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius-pill);
  color: var(--color-ink-muted);
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms, color 150ms;
  white-space: nowrap;
}

.page-ctx-btn:hover {
  color: var(--color-ink);
}

.page-ctx-btn.active {
  background: var(--color-fin-orange);
  color: #ffffff;
}
```

- [ ] **Step 2: Verify visually**

Build and open the extension popup. The header should show three small pill-shaped segments: "Auto" (orange/active), "Seite", "Aus". No old toggle button remains.

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.css"
git commit -m "feat: segmented control styles for page context mode"
```

---

### Task 3: Migrate JS state — `pageToggleEnabled` → `pageContextMode`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

This task only touches state declarations and storage load/save — no logic changes yet.

- [ ] **Step 1: Replace the state variable**

Find line:
```js
let pageToggleEnabled = true;
```
Replace with:
```js
let pageContextMode = "auto"; // "auto" | "on" | "off"
```

- [ ] **Step 2: Load `pageContextMode` from storage in `init()`**

In `init()`, after `settings = await loadSettings();` add:

```js
const stored = await browser.storage.local.get(["pageContextMode"]);
pageContextMode = stored.pageContextMode ?? "auto";
```

- [ ] **Step 3: Remove the `updatePageToggleUI` function and its call sites**

Delete the entire `updatePageToggleUI` function (it references `pageToggleEnabled` and `page-toggle-btn`). Also delete every call to `updatePageToggleUI()` in `fetchPageContent()`, `togglePageContext()`, and `init()`.

- [ ] **Step 4: Delete the `togglePageContext` function**

Delete the entire `togglePageContext` function — it will be replaced in Task 4.

- [ ] **Step 5: Remove the old event listener in `init()`**

Delete:
```js
document.getElementById("page-toggle-btn").addEventListener("click", togglePageContext);
```

- [ ] **Step 6: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "refactor: replace pageToggleEnabled with pageContextMode state"
```

---

### Task 4: Wire up Segmented Control click handler

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: Add `updatePageCtrlUI` function**

Add this function after `updateBaseUrlVisibility`:

```js
function updatePageCtrlUI() {
  document.querySelectorAll(".page-ctx-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === pageContextMode);
  });
}
```

- [ ] **Step 2: Add click handler in `init()`**

In `init()`, after the existing event listener registrations, add:

```js
document.getElementById("page-ctx-control").addEventListener("click", async (e) => {
  const btn = e.target.closest(".page-ctx-btn");
  if (!btn) return;
  pageContextMode = btn.dataset.mode;
  updatePageCtrlUI();
  await browser.storage.local.set({ pageContextMode });
});
```

- [ ] **Step 3: Call `updatePageCtrlUI()` during init**

In `init()`, after loading `pageContextMode` from storage (Task 3 Step 2), add:

```js
updatePageCtrlUI();
```

- [ ] **Step 4: Verify interactivity**

Open the popup. Click "Seite" — it should turn orange. Click "Aus" — "Aus" turns orange. Click "Auto" — "Auto" turns orange. Close and reopen the popup — the last-selected mode should still be active.

- [ ] **Step 5: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: page context segmented control click handler + persistence"
```

---

### Task 5: Implement `shouldIncludePageContext` (hybrid detection)

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: Add keyword-check helper**

Add this function in the `// ── Page Content Fetch` section:

```js
const PAGE_KEYWORDS_RE = /\b(diese[rn]?\s+(?:seite|artikel|text|inhalt)|was\s+steht\s+(?:hier|da|dort)|(?:hier|da|dort)\s+steht|auf\s+der\s+seite|den\s+text|dem\s+artikel|fasse\s+zusammen|übersetze\s+(?:das|den|die|mir)|erkläre\s+mir\s+das|this\s+page|the\s+article|what\s+does\s+it\s+say|summarize\s+this|translate\s+this)\b/i;

function keywordCheck(text) {
  return PAGE_KEYWORDS_RE.test(text);
}
```

- [ ] **Step 2: Add the mini API-call classifier**

Add this function after `keywordCheck`:

```js
async function classifyWithAI(text) {
  const providerId = settings.provider;
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return false;

  const systemMsg = "Antworte ausschließlich mit 'ja' oder 'nein', ohne Erklärung.";
  const userMsg = `Bezieht sich diese Frage auf den Inhalt einer bestimmten Webseite, die der Nutzer gerade geöffnet hat? Frage: ${text}`;

  try {
    if (providerId === "anthropic") {
      const res = await fetch(PROVIDERS.anthropic.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-allow-browser": "true"
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          system: systemMsg,
          messages: [{ role: "user", content: userMsg }]
        })
      });
      const json = await res.json();
      const answer = (json.content?.[0]?.text ?? "").toLowerCase();
      return answer.includes("ja") || answer.includes("yes");
    }

    if (providerId === "gemini") {
      const url = PROVIDERS.gemini.baseUrl.replace("{model}", model) + `?key=${settings.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userMsg }] }],
          systemInstruction: { parts: [{ text: systemMsg }] },
          generationConfig: { maxOutputTokens: 5 }
        })
      });
      const json = await res.json();
      const answer = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").toLowerCase();
      return answer.includes("ja") || answer.includes("yes");
    }

    // OpenAI-compatible (openai, local, hyperspace)
    const url = (providerId === "local" || providerId === "hyperspace")
      ? settings.baseUrl.replace(/\/$/, "") + "/chat/completions"
      : PROVIDERS.openai.baseUrl;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 5,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg }
        ]
      })
    });
    const json = await res.json();
    const answer = (json.choices?.[0]?.message?.content ?? "").toLowerCase();
    return answer.includes("ja") || answer.includes("yes");
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Add the top-level `shouldIncludePageContext` function**

Add after `classifyWithAI`:

```js
async function shouldIncludePageContext(text) {
  if (!currentPageContext || currentPageContext._debugError) return false;
  if (keywordCheck(text)) return true;
  return await classifyWithAI(text);
}
```

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: hybrid page-context detection (keyword + AI classifier)"
```

---

### Task 6: Make `buildSystemPrompt` accept an explicit flag; wire into `sendMessage`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: Update `buildSystemPrompt` signature**

Change:
```js
function buildSystemPrompt() {
  const base = settings.systemPrompt?.trim() ||
    "Du bist ein hilfreicher KI-Assistent.";

  if (!currentPageContext) return base;

  if (currentPageContext._debugError) {
    return base + "\n\n[DEBUG Seiteninhalt-Fehler]: " + currentPageContext._debugError;
  }

  if (!pageToggleEnabled) return base;

  return [
    base,
    "",
    `Der Nutzer befindet sich auf: ${currentPageContext.title}`,
    `URL: ${currentPageContext.url}`,
    `Seiteninhalt:\n${currentPageContext.text}`
  ].join("\n");
}
```

To:
```js
function buildSystemPrompt(includePageContext = false) {
  const base = settings.systemPrompt?.trim() ||
    "Du bist ein hilfreicher KI-Assistent.";

  if (!includePageContext || !currentPageContext || currentPageContext._debugError) return base;

  return [
    base,
    "",
    `Der Nutzer befindet sich auf: ${currentPageContext.title}`,
    `URL: ${currentPageContext.url}`,
    `Seiteninhalt:\n${currentPageContext.text}`
  ].join("\n");
}
```

- [ ] **Step 2: Resolve page context mode in `sendMessage` before building messages**

In `sendMessage`, find the block:
```js
const providerId = settings.provider;

let messages;
if (providerId === "anthropic" || providerId === "gemini") {
  messages = chatHistory.map(m => ({ role: m.role, content: m.content }));
} else {
  messages = [
    { role: "system", content: buildSystemPrompt() },
    ...chatHistory.map(m => ({ role: m.role, content: m.content }))
  ];
}
```

Replace with:
```js
const providerId = settings.provider;

const includeCtx = pageContextMode === "on"
  ? true
  : pageContextMode === "off"
    ? false
    : await shouldIncludePageContext(text);

let messages;
if (providerId === "anthropic" || providerId === "gemini") {
  messages = chatHistory.map(m => ({ role: m.role, content: m.content }));
} else {
  messages = [
    { role: "system", content: buildSystemPrompt(includeCtx) },
    ...chatHistory.map(m => ({ role: m.role, content: m.content }))
  ];
}
```

- [ ] **Step 3: Pass `includeCtx` into Anthropic and Gemini calls**

The `streamAnthropic` and `callGemini` functions call `buildSystemPrompt()` internally. Update `streamAnthropic` to accept `includeCtx`:

```js
async function* streamAnthropic(messages, includeCtx = false) {
  const systemPrompt = buildSystemPrompt(includeCtx);
  // rest unchanged
```

Update `callGemini` similarly:
```js
async function callGemini(messages, includeCtx = false) {
  const systemPrompt = buildSystemPrompt(includeCtx);
  // rest unchanged
```

Then in `sendMessage`, pass `includeCtx` when calling them:
```js
const generator = providerId === "anthropic"
  ? streamAnthropic(messages, includeCtx)
  : streamOpenAI(messages);
```
```js
fullResponse = await callGemini(messages, includeCtx);
```

- [ ] **Step 4: Verify end-to-end behaviour**

1. Set mode to **Aus** → ask "Was steht auf dieser Seite?" → no page content in response
2. Set mode to **Seite** → ask any question → page content always included (check via a follow-up like "what URL am I on?")
3. Set mode to **Auto** → ask "What is 2+2?" → no page context; ask "summarize this page" → page context included

- [ ] **Step 5: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: wire page context mode into sendMessage + buildSystemPrompt"
```

---

### Task 7: Clean up `fetchPageContent` and `startNewConversation`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

`fetchPageContent` and `startNewConversation` still call `updatePageToggleUI()` which was deleted. This task removes those dead references.

- [ ] **Step 1: Remove dead `updatePageToggleUI` calls**

In `fetchPageContent`, delete the two lines:
```js
updatePageToggleUI();
```
(there are two — one in the main path, one in the catch block and one at the end).

In `startNewConversation`, delete:
```js
updatePageToggleUI();
```

- [ ] **Step 2: Verify no remaining references**

```bash
grep -n "pageToggleEnabled\|updatePageToggleUI\|page-toggle-btn\|togglePageContext" \
  "Safari AI Agent Extension/Resources/popup.js"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "chore: remove dead updatePageToggleUI references"
```
