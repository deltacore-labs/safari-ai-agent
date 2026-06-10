# Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-conversation support with a dropdown history overlay to the Safari AI Agent extension.

**Architecture:** Replace the single `chatHistory` array + `chatHistory` storage key with a conversations model: an index of all conversations, individual `conv_<id>` keys, and an `active_conv_id` pointer. The UI adds a history dropdown overlay triggered by a clock icon in the header toolbar.

**Tech Stack:** Vanilla JS (ES modules), `browser.storage.local`, HTML/CSS in Safari Web Extension context.

---

## File Structure

| File | Change |
|------|--------|
| `Resources/popup.js` | Replace `loadHistory`/`saveHistory`, add conversation management functions, add history dropdown UI logic |
| `Resources/popup.html` | Add history button + dropdown container in chat-panel header |
| `Resources/popup.css` | Add styles for history button, dropdown overlay, conversation rows, active highlight |

---

### Task 1: Storage Layer — Conversation CRUD

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js:88-123` (replace `loadHistory`/`saveHistory`)

- [ ] **Step 1: Add module-level state for active conversation ID**

Find the module state block (around line 51) and add `activeConvId`:

```js
// ── Module State ──────────────────────────────────────────────
let settings = { ...DEFAULT_SETTINGS };
let chatHistory = [];
let activeConvId = null;          // ← add this line
let isStreaming = false;
```

- [ ] **Step 2: Add `generateConvId()` helper**

After the `saveSettings` function (around line 66), insert:

```js
function generateConvId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
```

- [ ] **Step 3: Replace `loadHistory` with `loadConversation`**

Remove the existing `loadHistory` function (lines 88–103) and replace with:

```js
async function loadConversation(id) {
  const result = await browser.storage.local.get([`conv_${id}`]);
  const msgs = Array.isArray(result[`conv_${id}`]) ? result[`conv_${id}`] : [];
  return msgs
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .map(m => {
      const content = typeof m.content === "string" ? m.content : String(m.content ?? "");
      return { ...m, content: content.length > 10000 ? content.slice(0, 10000) + "…" : content };
    });
}

async function loadConversationsIndex() {
  const result = await browser.storage.local.get(["conversations_index"]);
  return Array.isArray(result.conversations_index) ? result.conversations_index : [];
}

async function saveConversationsIndex(index) {
  await browser.storage.local.set({ conversations_index: index });
}
```

- [ ] **Step 4: Replace `saveHistory` with `saveConversation`**

Remove the existing `saveHistory` function (lines 105–123) and replace with:

```js
async function saveConversation(id, messages) {
  const MAX_BYTES = 512 * 1024;
  let trimmed = messages.length > 100 ? messages.slice(messages.length - 100) : [...messages];

  while (trimmed.length > 0) {
    const bytes = new TextEncoder().encode(JSON.stringify(trimmed)).length;
    if (bytes <= MAX_BYTES) break;
    trimmed = trimmed.slice(Math.ceil(trimmed.length * 0.2));
  }

  try {
    await browser.storage.local.set({ [`conv_${id}`]: trimmed });
  } catch {
    const minimal = trimmed.slice(-4);
    await browser.storage.local.set({ [`conv_${id}`]: minimal });
  }
}

async function updateConversationIndex(id, firstUserMessage) {
  const MAX_CONVERSATIONS = 50;
  let index = await loadConversationsIndex();

  const title = firstUserMessage
    ? firstUserMessage.slice(0, 60) + (firstUserMessage.length > 60 ? "…" : "")
    : "Neue Unterhaltung";

  const existing = index.findIndex(c => c.id === id);
  const entry = { id, title, updatedAt: Date.now() };

  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.unshift(entry);
  }

  // Sort newest first and enforce max limit
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  const removed = index.splice(MAX_CONVERSATIONS);

  // Delete storage for removed conversations
  for (const conv of removed) {
    try { await browser.storage.local.remove(`conv_${conv.id}`); } catch { /* ignore */ }
  }

  await saveConversationsIndex(index);
}
```

- [ ] **Step 5: Add `setActiveConvId` helper**

```js
async function setActiveConvId(id) {
  activeConvId = id;
  await browser.storage.local.set({ active_conv_id: id });
}
```

- [ ] **Step 6: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: add conversation storage layer (loadConversation, saveConversation, index)"
```

---

### Task 2: Migrate Existing Data + Update `init()`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (init function, ~line 1391)

- [ ] **Step 1: Add migration function**

Insert after `setActiveConvId`:

```js
async function migrateOldChatHistory() {
  const result = await browser.storage.local.get(["chatHistory", "conversations_index"]);
  // Only migrate if old key exists and no new index yet
  if (!result.chatHistory || result.conversations_index) return;

  const messages = Array.isArray(result.chatHistory) ? result.chatHistory : [];
  if (messages.length === 0) {
    await browser.storage.local.remove("chatHistory");
    return;
  }

  const id = generateConvId();
  await saveConversation(id, messages);
  const firstUser = messages.find(m => m.role === "user");
  await updateConversationIndex(id, firstUser?.content ?? "");
  await setActiveConvId(id);
  await browser.storage.local.remove("chatHistory");
}
```

- [ ] **Step 2: Update `init()` to use new conversation system**

In `init()`, find these lines (around 1410–1419):

```js
chatHistory = await loadHistory();
applyTheme(settings.provider, settings.model);

if (chatHistory.length === 0) {
  renderEmptyState();
} else {
  chatHistory.forEach(m =>
    renderMessage(m.role === "assistant" ? "ai" : "user", m.content)
  );
}
```

Replace with:

```js
await migrateOldChatHistory();

const storedId = await browser.storage.local.get(["active_conv_id"]);
const index = await loadConversationsIndex();

let convId = storedId.active_conv_id;
// Validate that active ID still exists in index
if (!convId || !index.find(c => c.id === convId)) {
  convId = generateConvId();
  await setActiveConvId(convId);
} else {
  activeConvId = convId;
}

chatHistory = await loadConversation(activeConvId);
applyTheme(settings.provider, settings.model);

if (chatHistory.length === 0) {
  renderEmptyState();
} else {
  chatHistory.forEach(m =>
    renderMessage(m.role === "assistant" ? "ai" : "user", m.content)
  );
}
```

- [ ] **Step 3: Update all `saveHistory(chatHistory)` call sites to use `saveConversation`**

Search for all occurrences of `saveHistory(chatHistory)` in popup.js (there are 3: around lines 1129, 1280, 1300/1301) and replace each with:

```js
await saveConversation(activeConvId, chatHistory);
const firstUser = chatHistory.find(m => m.role === "user");
await updateConversationIndex(activeConvId, firstUser?.content ?? "");
```

- [ ] **Step 4: Update `clearHistory()` to clear only current conversation**

Find `clearHistory()` (around line 1365) and replace:

```js
async function clearHistory() {
  chatHistory = [];
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
  try {
    await saveConversation(activeConvId, []);
    // Remove from index since it's now empty
    let index = await loadConversationsIndex();
    index = index.filter(c => c.id !== activeConvId);
    await saveConversationsIndex(index);
  } catch { /* ignore */ }
}
```

- [ ] **Step 5: Update `startNewConversation()` to use new system**

Find `startNewConversation()` (around line 1373) and replace:

```js
async function startNewConversation() {
  if (chatHistory.length === 0) return; // guard: don't create empty conv

  const newId = generateConvId();
  await setActiveConvId(newId);
  chatHistory = [];
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
  currentPageContext = null;
  if (pageContextMode !== "off") fetchPageContent();
}
```

- [ ] **Step 6: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: migrate old chatHistory on first launch, wire init() to conversation system"
```

---

### Task 3: HTML — History Button + Dropdown Container

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.html`

- [ ] **Step 1: Add history button to chat-panel header**

In [popup.html](Safari AI Agent Extension/Resources/popup.html), find the `header-actions` div (around line 20). Add a history button **before** the existing `#new-chat-btn`:

```html
<button id="history-btn" class="icon-btn" aria-label="Gesprächsverlauf" title="Gesprächsverlauf">
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
    <path d="M8 4.5V8l2.5 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</button>
```

- [ ] **Step 2: Add dropdown overlay container**

Directly after the closing `</header>` tag (around line 39), add:

```html
<!-- History Dropdown Overlay -->
<div id="history-dropdown" class="history-dropdown hidden" role="listbox" aria-label="Gesprächsverlauf">
  <button id="new-conv-btn" class="history-new-btn" role="option">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    Neue Unterhaltung
  </button>
  <div id="history-list" class="history-list"></div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.html"
git commit -m "feat: add history button and dropdown overlay container to popup HTML"
```

---

### Task 4: CSS — History Dropdown Styles

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.css`

- [ ] **Step 1: Add history dropdown styles at end of popup.css**

```css
/* ── History Dropdown ─────────────────────────────────────────── */
.history-dropdown {
  position: absolute;
  top: 48px; /* height of header */
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--color-surface-1);
  border-bottom: 1px solid var(--color-hairline);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  max-height: 280px;
  display: flex;
  flex-direction: column;
}

.history-dropdown.hidden {
  display: none;
}

.history-new-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  width: 100%;
  padding: var(--space-xs) var(--space-md);
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-hairline-soft);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-accent);
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
}

.history-new-btn:hover {
  background: var(--color-surface-2);
}

.history-list {
  overflow-y: auto;
  flex: 1;
}

.history-item {
  display: flex;
  flex-direction: column;
  padding: var(--space-xs) var(--space-md);
  cursor: pointer;
  border-bottom: 1px solid var(--color-hairline-soft);
  transition: background 0.1s;
}

.history-item:last-child {
  border-bottom: none;
}

.history-item:hover {
  background: var(--color-surface-2);
}

.history-item.active {
  background: var(--color-surface-2);
  border-left: 2px solid var(--color-accent);
  padding-left: calc(var(--space-md) - 2px);
}

.history-item-title {
  font-size: 13px;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-item-date {
  font-size: 11px;
  color: var(--color-ink-subtle);
  margin-top: 2px;
}

/* Ensure chat-panel header is positioned so dropdown can be absolute */
#chat-panel {
  position: relative;
}
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.css"
git commit -m "feat: add history dropdown styles"
```

---

### Task 5: JS — History Dropdown UI Logic

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: Add `formatRelativeDate` helper**

Add after `setActiveConvId`:

```js
function formatRelativeDate(timestamp) {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Heute";
  if (diffDays === 1) return "Gestern";
  if (diffDays < 7) return `Vor ${diffDays} Tagen`;
  if (diffDays < 30) return `Vor ${Math.floor(diffDays / 7)} Woche${Math.floor(diffDays / 7) > 1 ? "n" : ""}`;
  return `Vor ${Math.floor(diffDays / 30)} Monat${Math.floor(diffDays / 30) > 1 ? "en" : ""}`;
}
```

- [ ] **Step 2: Add `renderHistoryDropdown` function**

```js
async function renderHistoryDropdown() {
  const index = await loadConversationsIndex();
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  for (const conv of index) {
    const item = document.createElement("div");
    item.className = "history-item" + (conv.id === activeConvId ? " active" : "");
    item.setAttribute("role", "option");
    item.dataset.convId = conv.id;

    const titleEl = document.createElement("div");
    titleEl.className = "history-item-title";
    titleEl.textContent = conv.title || "Unterhaltung";

    const dateEl = document.createElement("div");
    dateEl.className = "history-item-date";
    dateEl.textContent = formatRelativeDate(conv.updatedAt);

    item.appendChild(titleEl);
    item.appendChild(dateEl);
    list.appendChild(item);
  }
}
```

- [ ] **Step 3: Add `openHistoryDropdown` / `closeHistoryDropdown` functions**

```js
async function openHistoryDropdown() {
  await renderHistoryDropdown();
  document.getElementById("history-dropdown").classList.remove("hidden");
}

function closeHistoryDropdown() {
  document.getElementById("history-dropdown").classList.add("hidden");
}
```

- [ ] **Step 4: Add `switchToConversation` function**

```js
async function switchToConversation(id) {
  closeHistoryDropdown();
  await setActiveConvId(id);
  chatHistory = await loadConversation(id);
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  if (chatHistory.length === 0) {
    renderEmptyState();
  } else {
    chatHistory.forEach(m =>
      renderMessage(m.role === "assistant" ? "ai" : "user", m.content)
    );
  }
  currentPageContext = null;
  if (pageContextMode !== "off") fetchPageContent();
}
```

- [ ] **Step 5: Wire up event listeners in `init()`**

In `init()`, after the existing `document.getElementById("new-chat-btn").addEventListener(...)` line (~line 1438), add:

```js
document.getElementById("history-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById("history-dropdown");
  if (dropdown.classList.contains("hidden")) {
    openHistoryDropdown();
  } else {
    closeHistoryDropdown();
  }
});

document.getElementById("new-conv-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  closeHistoryDropdown();
  startNewConversation();
});

document.getElementById("history-list").addEventListener("click", (e) => {
  const item = e.target.closest(".history-item");
  if (!item) return;
  switchToConversation(item.dataset.convId);
});

document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("history-dropdown");
  if (!dropdown.classList.contains("hidden") &&
      !dropdown.contains(e.target) &&
      e.target.id !== "history-btn") {
    closeHistoryDropdown();
  }
});
```

- [ ] **Step 6: Remove or update the old `new-chat-btn` listener**

The existing `#new-chat-btn` listener at the bottom of `init()` calls `startNewConversation` — this stays as-is, but `startNewConversation` was already updated in Task 2 with the empty-chat guard.

- [ ] **Step 7: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: add history dropdown UI — open/close, render conversations, switch conversation"
```

---

### Task 6: End-to-End Smoke Test

No automated tests are possible in the Safari extension sandbox, so verify manually:

- [ ] **Step 1: Build and run in Xcode**

Open the Xcode project, build to a simulator or device, and enable the extension in Safari Settings.

- [ ] **Step 2: Verify migration**

  - If there is an existing `chatHistory` in storage, it should appear as the first (and only) conversation in the history dropdown after the first launch.
  - Open Safari Web Inspector → Storage → Local Storage and confirm `chatHistory` key is gone, replaced by `conversations_index`, `conv_<id>`, and `active_conv_id`.

- [ ] **Step 3: Verify new chat flow**

  - Send a message in the current chat.
  - Click the clock icon → dropdown opens.
  - Click "Neue Unterhaltung" → dropdown closes, empty state shown, new conversation is active.
  - Open dropdown again → two entries visible, most recent first.

- [ ] **Step 4: Verify switching**

  - Send a message in the new chat.
  - Open dropdown → click the first conversation → messages from that conversation load.
  - Active conversation is highlighted in the dropdown.

- [ ] **Step 5: Verify empty-chat guard**

  - Open the extension with no messages typed.
  - Open dropdown → click "Neue Unterhaltung" → nothing should happen (no new empty entry added to the list).

- [ ] **Step 6: Verify 50-conversation limit**

  - Not required to test manually with 50 chats; ensure the `MAX_CONVERSATIONS` constant is set to `50` in `updateConversationIndex`.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete chat history feature — multi-conversation with history dropdown"
```
