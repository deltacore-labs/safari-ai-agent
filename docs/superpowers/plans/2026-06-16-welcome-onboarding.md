# Welcome Onboarding Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a 4-step bottom-sheet overlay on first popup open that walks new users through the extension's key features.

**Architecture:** A hidden `#welcome-overlay` div sits above all panels in `popup.html`. On init, `checkWelcome()` reads `welcome_seen` from `browser.storage.local` and shows the overlay if absent. Four step containers are rendered; only the active one is visible. Navigation is handled by three functions: `showWelcomeStep(n)`, `advanceWelcome()`, and `dismissWelcome(openSettings)`. All text goes through the existing i18n system.

**Tech Stack:** Vanilla JS ES modules, `browser.storage.local`, existing CSS custom properties, existing `applyTranslations()` / `t()` i18n helpers.

---

## File Map

| File | Change |
|------|--------|
| `Safari AI Agent Extension/Resources/i18n.js` | Add 10 new translation keys (DE + EN) |
| `Safari AI Agent Extension/Resources/popup.html` | Add `#welcome-overlay` HTML block inside `#app` |
| `Safari AI Agent Extension/Resources/popup.css` | Add welcome overlay CSS rules + dark mode variants |
| `Safari AI Agent Extension/Resources/popup.js` | Add `checkWelcome`, `showWelcomeStep`, `advanceWelcome`, `dismissWelcome`; call `checkWelcome()` from `init()` |

---

### Task 1: Add i18n keys

**Files:**
- Modify: `Safari AI Agent Extension/Resources/i18n.js`

- [ ] **Step 1: Add DE keys to the `de` object** (after the last key in that block, before the closing `},`)

```js
    // Welcome onboarding
    welcome_step1_title: "Willkommen bei AI Agent",
    welcome_step1_desc: "Dein KI-Assistent direkt im Safari-Browser. Stelle Fragen, lass Seiten erklären oder erledige Aufgaben automatisch.",
    welcome_step2_title: "Seitenkontext",
    welcome_step2_desc: "Ich lese die aktuelle Seite mit und kann sie zusammenfassen, übersetzen oder als Kontext für deine Frage nutzen.",
    welcome_step3_title: "Web-Agent",
    welcome_step3_desc: "Beschreib eine Aufgabe — ich klicke, tippe und navigiere für dich. Formulare ausfüllen, Seiten durchsuchen, Aktionen ausführen.",
    welcome_step4_title: "Einrichten",
    welcome_step4_desc: "Verbinde deinen API-Key von Anthropic, OpenAI, Gemini — oder nutze ein lokales Modell via Ollama.",
    welcome_btn_next: "Weiter",
    welcome_btn_skip: "Überspringen",
    welcome_btn_setup: "Einstellungen öffnen",
    welcome_btn_later: "Später einrichten",
```

- [ ] **Step 2: Add EN keys to the `en` object** (same position in the `en` block)

```js
    // Welcome onboarding
    welcome_step1_title: "Welcome to AI Agent",
    welcome_step1_desc: "Your AI assistant directly in Safari. Ask questions, get pages explained, or automate tasks.",
    welcome_step2_title: "Page Context",
    welcome_step2_desc: "I read the current page and can summarise, translate, or use it as context for your questions.",
    welcome_step3_title: "Web Agent",
    welcome_step3_desc: "Describe a task — I click, type, and navigate for you. Fill forms, search pages, execute actions.",
    welcome_step4_title: "Set Up",
    welcome_step4_desc: "Connect your API key from Anthropic, OpenAI, Gemini — or use a local model via Ollama.",
    welcome_btn_next: "Next",
    welcome_btn_skip: "Skip",
    welcome_btn_setup: "Open Settings",
    welcome_btn_later: "Set up later",
```

- [ ] **Step 3: Verify the file parses cleanly**

```bash
node --input-type=module < "Safari AI Agent Extension/Resources/i18n.js"
```

Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/i18n.js"
git commit -m "feat(i18n): add welcome onboarding translation keys"
```

---

### Task 2: Add HTML markup

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.html`

- [ ] **Step 1: Add the overlay block** — insert directly before `</div><!-- #app -->` (the closing tag of `<div id="app">`), which is the line just before the `<script>` tags at the bottom of `<body>`:

```html
    <!-- WELCOME OVERLAY -->
    <div id="welcome-overlay" class="welcome-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div class="welcome-sheet">

        <div class="welcome-dots" aria-hidden="true">
          <span class="welcome-dot active" data-step="0"></span>
          <span class="welcome-dot" data-step="1"></span>
          <span class="welcome-dot" data-step="2"></span>
          <span class="welcome-dot" data-step="3"></span>
        </div>

        <!-- Step 0 -->
        <div class="welcome-step" data-step="0">
          <div class="welcome-icon">👋</div>
          <h2 id="welcome-title" class="welcome-step-title" data-i18n="welcome_step1_title">Willkommen bei AI Agent</h2>
          <p class="welcome-step-desc" data-i18n="welcome_step1_desc">Dein KI-Assistent direkt im Safari-Browser.</p>
        </div>

        <!-- Step 1 -->
        <div class="welcome-step hidden" data-step="1">
          <div class="welcome-icon">🌐</div>
          <h2 class="welcome-step-title" data-i18n="welcome_step2_title">Seitenkontext</h2>
          <p class="welcome-step-desc" data-i18n="welcome_step2_desc">Ich lese die aktuelle Seite mit…</p>
        </div>

        <!-- Step 2 -->
        <div class="welcome-step hidden" data-step="2">
          <div class="welcome-icon">🤖</div>
          <h2 class="welcome-step-title" data-i18n="welcome_step3_title">Web-Agent</h2>
          <p class="welcome-step-desc" data-i18n="welcome_step3_desc">Beschreib eine Aufgabe…</p>
        </div>

        <!-- Step 3 -->
        <div class="welcome-step hidden" data-step="3">
          <div class="welcome-icon">⚙️</div>
          <h2 class="welcome-step-title" data-i18n="welcome_step4_title">Einrichten</h2>
          <p class="welcome-step-desc" data-i18n="welcome_step4_desc">Verbinde deinen API-Key…</p>
        </div>

        <button id="welcome-next-btn" class="welcome-btn-next" data-i18n="welcome_btn_next">Weiter</button>
        <button id="welcome-skip-btn" class="welcome-btn-skip" data-i18n="welcome_btn_skip">Überspringen</button>

      </div>
    </div>
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.html"
git commit -m "feat(html): add welcome overlay markup"
```

---

### Task 3: Add CSS

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.css`

- [ ] **Step 1: Append welcome overlay styles** at the end of `popup.css`:

```css
/* ── Welcome Onboarding Overlay ──────────────────────────────── */
.welcome-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.welcome-overlay.hidden {
  display: none;
}

.welcome-sheet {
  background: var(--color-surface-1);
  border-radius: 20px 20px 0 0;
  width: 100%;
  padding: 24px 24px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.welcome-dots {
  display: flex;
  gap: 6px;
}

.welcome-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: var(--color-hairline);
  transition: width 0.2s ease, background 0.2s ease;
}

.welcome-dot.active {
  width: 18px;
  background: var(--color-ink);
}

.welcome-step {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.welcome-step.hidden {
  display: none;
}

.welcome-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--color-surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  line-height: 1;
}

.welcome-step-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--color-ink);
}

.welcome-step-desc {
  font-size: 13px;
  color: var(--color-ink-muted);
  line-height: 1.5;
  max-width: 280px;
}

.welcome-btn-next {
  width: 100%;
  height: 44px;
  background: var(--color-ink);
  color: var(--color-surface-1);
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: opacity 0.15s;
}

.welcome-btn-next:hover { opacity: 0.85; }

.welcome-btn-next.setup {
  background: #2563eb;
}

.welcome-btn-skip {
  background: none;
  border: none;
  color: var(--color-ink-subtle);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  padding: 0;
  margin-top: -4px;
}

.welcome-btn-skip:hover { color: var(--color-ink-muted); }
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.css"
git commit -m "feat(css): add welcome overlay styles"
```

---

### Task 4: Add JavaScript logic

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: Add the module-level state variable** — add after the existing top-level `let` declarations (around line 70, near `let agentRunning = false;`):

```js
let welcomeStep = 0;
```

- [ ] **Step 2: Add the four welcome functions** — add as a new section before `// ── Panel Navigation ──`:

```js
// ── Welcome Onboarding ────────────────────────────────────────
async function checkWelcome() {
  const { welcome_seen } = await browser.storage.local.get("welcome_seen");
  if (!welcome_seen) showWelcomeOverlay();
}

function showWelcomeOverlay() {
  welcomeStep = 0;
  const overlay = document.getElementById("welcome-overlay");
  overlay.classList.remove("hidden");
  showWelcomeStep(0);
  applyTranslations(overlay);
}

function showWelcomeStep(n) {
  welcomeStep = n;
  document.querySelectorAll(".welcome-step").forEach((el, i) => {
    el.classList.toggle("hidden", i !== n);
  });
  document.querySelectorAll(".welcome-dot").forEach((el, i) => {
    el.classList.toggle("active", i === n);
  });
  const nextBtn = document.getElementById("welcome-next-btn");
  const isLast = n === 3;
  nextBtn.classList.toggle("setup", isLast);
  nextBtn.dataset.i18n = isLast ? "welcome_btn_setup" : "welcome_btn_next";
  nextBtn.textContent = t(nextBtn.dataset.i18n);
  const skipBtn = document.getElementById("welcome-skip-btn");
  skipBtn.dataset.i18n = isLast ? "welcome_btn_later" : "welcome_btn_skip";
  skipBtn.textContent = t(skipBtn.dataset.i18n);
}

function advanceWelcome() {
  if (welcomeStep < 3) {
    showWelcomeStep(welcomeStep + 1);
  } else {
    dismissWelcome(true);
  }
}

async function dismissWelcome(openSettingsAfter = false) {
  await browser.storage.local.set({ welcome_seen: true });
  document.getElementById("welcome-overlay").classList.add("hidden");
  if (openSettingsAfter) openSettings();
}
```

- [ ] **Step 3: Wire up event listeners** — inside `init()`, add after the existing event listener block (after the last `addEventListener` call, before the closing `}` of `init`):

```js
  document.getElementById("welcome-next-btn").addEventListener("click", advanceWelcome);
  document.getElementById("welcome-skip-btn").addEventListener("click", () => dismissWelcome(false));
```

- [ ] **Step 4: Call `checkWelcome()` from `init()`** — add at the very end of the `init()` function body, after the context menu handler block:

```js
  await checkWelcome();
```

- [ ] **Step 5: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat(js): add welcome onboarding overlay logic"
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Build and run the extension in Xcode** — open the project, build (⌘B), and run the Safari host app

- [ ] **Step 2: Enable the extension** in Safari → Settings → Extensions → AI Agent ✓

- [ ] **Step 3: Open the extension popup** — the welcome overlay should appear over the blurred chat panel

- [ ] **Step 4: Step through all 4 steps** using "Weiter". Verify:
  - Progress dots advance correctly
  - Step 4 shows blue "Einstellungen öffnen" button and "Später einrichten" link
  - Clicking "Einstellungen öffnen" closes overlay and opens Settings panel

- [ ] **Step 5: Test skip** — reload popup, click "Überspringen" on step 1 → overlay closes, chat is usable

- [ ] **Step 6: Verify "seen" persists** — close and reopen the popup → overlay must NOT appear again

- [ ] **Step 7: Test dark mode** — toggle dark mode, reopen → overlay sheet background should match dark theme

- [ ] **Step 8: Test language switch** — switch language to EN in Settings, reopen popup (clear `welcome_seen` via dev tools first) → all text should be in English

- [ ] **Step 9: Final commit if any fixes were made**

```bash
git add -p
git commit -m "fix(welcome): smoke test fixes"
```
