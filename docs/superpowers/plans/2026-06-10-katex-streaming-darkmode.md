# KaTeX-Formeln, Streaming-Fix, Dark Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drei unabhängige UI-Verbesserungen: LaTeX-Formeln via KaTeX rendern, Streaming-Ruckler beseitigen, systembasierter Dark Mode pro Provider-Theme.

**Architecture:** (1) KaTeX lokal gebundled, `renderMathInElement()` nach Stream-Ende. (2) 50ms-Flush-Buffer + `requestAnimationFrame` für gebatchte DOM-Updates; Scroll nur wenn User am Ende. (3) `@media (prefers-color-scheme: dark)` CSS-Blöcke pro Provider-Theme — kein JS.

**Tech Stack:** Vanilla JS/CSS, KaTeX 0.16.x (lokal), Safari Web Extension (Manifest V3)

---

## File Map

| File | Change |
|---|---|
| `Safari AI Agent Extension/Resources/katex/katex.min.js` | Neu anlegen (KaTeX download) |
| `Safari AI Agent Extension/Resources/katex/katex.min.css` | Neu anlegen |
| `Safari AI Agent Extension/Resources/katex/fonts/` | Neu anlegen (KaTeX Fonts-Ordner) |
| `Safari AI Agent Extension/Resources/popup.html` | KaTeX CSS + JS einbinden |
| `Safari AI Agent Extension/Resources/popup.css` | Dark-Mode-Blöcke + `min-height` für AI-Bubble |
| `Safari AI Agent Extension/Resources/popup.js` | Streaming-Buffer + `renderMathInElement` nach Stream |

---

## Task 1: Dark Mode CSS

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.css`

- [ ] **Step 1: Dark-Mode-Block für das Default-Theme (Hyperspace/Fin) ans Ende von popup.css anhängen**

```css
/* ── Dark Mode ───────────────────────────────────────────────── */
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --color-canvas:        #1c1a17;
    --color-surface-1:     #242220;
    --color-surface-2:     #2e2b27;
    --color-ink:           #e8e5e0;
    --color-ink-muted:     #9c9890;
    --color-ink-subtle:    #7a7670;
    --color-ink-tertiary:  #5e5b56;
    --color-hairline:      #3a3733;
    --color-hairline-soft: #2e2b27;
    --color-accent:        #ff6b1a;
    --color-fin-orange:    #ff6b1a;
    --color-error:         #ff6b6b;
  }

  /* Anthropic dark */
  [data-theme="anthropic"] {
    color-scheme: dark;
    --color-canvas:        #1a1917;
    --color-surface-1:     #222018;
    --color-surface-2:     #2b2820;
    --color-ink:           #e5e1da;
    --color-ink-muted:     #97948d;
    --color-ink-subtle:    #767269;
    --color-ink-tertiary:  #5a5750;
    --color-hairline:      #383430;
    --color-hairline-soft: #2b2820;
    --color-accent:        #d9896a;
    --color-fin-orange:    #d9896a;
    --color-error:         #e87070;
  }

  /* OpenAI dark */
  [data-theme="openai"] {
    color-scheme: dark;
    --color-canvas:        #171717;
    --color-surface-1:     #212121;
    --color-surface-2:     #2a2a2a;
    --color-ink:           #ececec;
    --color-ink-muted:     #9a9a9a;
    --color-ink-subtle:    #767676;
    --color-ink-tertiary:  #555555;
    --color-hairline:      #383838;
    --color-hairline-soft: #2a2a2a;
    --color-accent:        #19c499;
    --color-fin-orange:    #19c499;
    --color-error:         #ff6b6b;
  }

  /* Gemini dark */
  [data-theme="gemini"] {
    color-scheme: dark;
    --color-canvas:        #13141f;
    --color-surface-1:     #1c1e2e;
    --color-surface-2:     #23263a;
    --color-ink:           #e2e4f0;
    --color-ink-muted:     #8a8da8;
    --color-ink-subtle:    #686b88;
    --color-ink-tertiary:  #4e5168;
    --color-hairline:      #2e3150;
    --color-hairline-soft: #23263a;
    --color-accent:        #6ba8ff;
    --color-fin-orange:    #6ba8ff;
    --color-error:         #ff6b6b;
  }

  /* select dropdown arrow in dark mode */
  .settings-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' stroke='%239c9890' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  }
}
```

- [ ] **Step 2: `min-height` für AI-Bubble ergänzen — in popup.css die bestehende `.message-bubble.ai`-Regel suchen (Zeile ~269) und `min-height: 1lh;` hinzufügen**

Die bestehende Regel sieht so aus:
```css
.message-bubble.ai {
  background: var(--color-surface-1);
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-xs);
}
```

Ändern zu:
```css
.message-bubble.ai {
  background: var(--color-surface-1);
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-xs);
  min-height: 1lh;
}
```

- [ ] **Step 3: Im Browser/Extension testen — macOS System-Dark-Mode ein- und ausschalten (System-Einstellungen → Erscheinungsbild) und prüfen ob alle 4 Provider-Themes korrekt umschalten**

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.css"
git commit -m "feat: dark mode per provider theme via prefers-color-scheme"
```

---

## Task 2: Streaming-Buffer — Ruckler beseitigen

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (Zeilen ~1025–1037 und ~1076–1088)

Es gibt **zwei** Streaming-Loops die beide umgebaut werden müssen:
1. Erste Antwort: Zeilen 1025–1037 (Variable `aiBubble`, `fullResponse`)
2. Web-Fallback-Antwort: Zeilen 1076–1088 (Variable `webBubble`, `webResponse`)

Das Muster für beide ist identisch: einen Flush-Helper einbauen.

- [ ] **Step 1: `flushStreamBuffer` Helper-Funktion vor `sendMessage` einfügen**

Suche die Zeile `// ── Send Message ──────────────────────────────────────────────` in popup.js und füge **davor** ein:

```js
// ── Streaming Flush Helper ────────────────────────────────────
function makeStreamFlusher(getBubble, getResponse) {
  let timer = null;
  function flush() {
    timer = null;
    const bubble = getBubble();
    if (!bubble) return;
    requestAnimationFrame(() => {
      bubble.innerHTML = markdownToHtml(getResponse());
      bubble._rawText = getResponse();
      const list = document.getElementById("messages");
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      if (nearBottom) list.scrollTop = list.scrollHeight;
    });
  }
  function schedule() {
    if (!timer) timer = setTimeout(flush, 50);
  }
  function finalize() {
    if (timer) { clearTimeout(timer); timer = null; }
    flush();
  }
  return { schedule, finalize };
}
```

- [ ] **Step 2: Ersten Streaming-Loop umbauen (Zeilen ~1025–1037)**

Aktueller Code (ca. Zeile 1025–1037):
```js
      let firstToken = true;
      for await (const token of generator) {
        if (firstToken) {
          typingEl.classList.add("hidden");
          aiBubble = renderMessage("ai", "");
          firstToken = false;
        }
        fullResponse += token;
        aiBubble.innerHTML = markdownToHtml(fullResponse);
        aiBubble._rawText = fullResponse;
        scrollToBottomIfNear();
      }
```

Ersetzen durch:
```js
      let firstToken = true;
      const flusher = makeStreamFlusher(() => aiBubble, () => fullResponse);
      for await (const token of generator) {
        if (firstToken) {
          typingEl.classList.add("hidden");
          aiBubble = renderMessage("ai", "");
          firstToken = false;
        }
        fullResponse += token;
        flusher.schedule();
      }
      flusher.finalize();
```

- [ ] **Step 3: Web-Fallback-Streaming-Loop umbauen (Zeilen ~1076–1088)**

Aktueller Code (ca. Zeile 1076–1088):
```js
          let firstWebToken = true;
          for await (const token of webGenerator) {
            if (firstWebToken) {
              webBubble = renderMessage("ai", "");
              firstWebToken = false;
            }
            webResponse += token;
            webBubble.innerHTML = markdownToHtml(webResponse);
            webBubble._rawText = webResponse;
            scrollToBottomIfNear();
          }
```

Ersetzen durch:
```js
          let firstWebToken = true;
          const webFlusher = makeStreamFlusher(() => webBubble, () => webResponse);
          for await (const token of webGenerator) {
            if (firstWebToken) {
              webBubble = renderMessage("ai", "");
              firstWebToken = false;
            }
            webResponse += token;
            webFlusher.schedule();
          }
          webFlusher.finalize();
```

- [ ] **Step 4: Extension neu laden und Streaming testen — eine Frage stellen, Text sollte flüssig ohne Ruckler erscheinen; hochscrollen während die Antwort kommt, die Liste sollte nicht zurückspringen**

- [ ] **Step 5: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "fix: batch streaming DOM updates — 50ms flush timer eliminates layout jank"
```

---

## Task 3: KaTeX herunterladen und ins Bundle legen

**Files:**
- Create: `Safari AI Agent Extension/Resources/katex/katex.min.js`
- Create: `Safari AI Agent Extension/Resources/katex/katex.min.css`
- Create: `Safari AI Agent Extension/Resources/katex/auto-render.min.js`
- Create: `Safari AI Agent Extension/Resources/katex/fonts/` (KaTeX-Fonts)

- [ ] **Step 1: KaTeX 0.16.x herunterladen**

```bash
cd "/Users/I767513/Xcode/Safari AI Agent/Safari AI Agent Extension/Resources"
mkdir -p katex/fonts

# KaTeX-Dateien herunterladen
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" -o katex/katex.min.js
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" -o katex/katex.min.css
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" -o katex/auto-render.min.js
```

- [ ] **Step 2: KaTeX-Fonts herunterladen — nur die tatsächlich benötigten Schriftschnitte (woff2)**

```bash
cd "/Users/I767513/Xcode/Safari AI Agent/Safari AI Agent Extension/Resources/katex/fonts"

# KaTeX Main (reguläre Mathe-Zeichen)
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Main-Regular.woff2" -o KaTeX_Main-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Main-Bold.woff2" -o KaTeX_Main-Bold.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Main-Italic.woff2" -o KaTeX_Main-Italic.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Main-BoldItalic.woff2" -o KaTeX_Main-BoldItalic.woff2

# KaTeX Math (Kursiv-Buchstaben in Formeln)
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Math-Italic.woff2" -o KaTeX_Math-Italic.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Math-BoldItalic.woff2" -o KaTeX_Math-BoldItalic.woff2

# KaTeX Size (große Klammern, Summenzeichen etc.)
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Size1-Regular.woff2" -o KaTeX_Size1-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Size2-Regular.woff2" -o KaTeX_Size2-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Size3-Regular.woff2" -o KaTeX_Size3-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Size4-Regular.woff2" -o KaTeX_Size4-Regular.woff2

# KaTeX Symbols (griechische Buchstaben, Operatoren)
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_AMS-Regular.woff2" -o KaTeX_AMS-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Caligraphic-Regular.woff2" -o KaTeX_Caligraphic-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Greek-Regular.woff2" -o KaTeX_Greek-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Greek-Italic.woff2" -o KaTeX_Greek-Italic.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_SansSerif-Regular.woff2" -o KaTeX_SansSerif-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Script-Regular.woff2" -o KaTeX_Script-Regular.woff2
curl -L "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/fonts/KaTeX_Typewriter-Regular.woff2" -o KaTeX_Typewriter-Regular.woff2
```

- [ ] **Step 3: Prüfen ob alle Dateien vorhanden sind**

```bash
ls -la "/Users/I767513/Xcode/Safari AI Agent/Safari AI Agent Extension/Resources/katex/"
ls "/Users/I767513/Xcode/Safari AI Agent/Safari AI Agent Extension/Resources/katex/fonts/" | wc -l
# Erwartet: 3 Dateien in katex/, 17 Fonts in fonts/
```

- [ ] **Step 4: `katex.min.css` Font-Pfade prüfen — die CSS referenziert Fonts relativ, das muss zu `./fonts/KaTeX_...` passen**

```bash
grep "url(" "/Users/I767513/Xcode/Safari AI Agent/Safari AI Agent Extension/Resources/katex/katex.min.css" | head -5
# Soll ausgeben: url(fonts/KaTeX_... — ohne führendes /
```

Falls die Pfade stimmen (relativ, kein `/`), nichts tun. Falls sie auf CDN zeigen, mit sed ersetzen:
```bash
# Nur ausführen wenn Fonts auf CDN zeigen:
sed -i '' 's|https://cdn.jsdelivr.net/npm/katex@[^/]*/dist/fonts/|fonts/|g' \
  "/Users/I767513/Xcode/Safari AI Agent/Safari AI Agent Extension/Resources/katex/katex.min.css"
```

- [ ] **Step 5: Xcode-Projekt — katex-Ordner dem Target hinzufügen**

In Xcode: Rechtsklick auf `Safari AI Agent Extension/Resources` → "Add Files to…" → `katex/`-Ordner auswählen → Target `Safari AI Agent Extension` angehakt lassen → "Add". Danach prüfen ob `katex/katex.min.js`, `katex/katex.min.css` und `katex/fonts/` im Xcode-Projekt-Navigator erscheinen.

- [ ] **Step 6: Commit**

```bash
git add "Safari AI Agent Extension/Resources/katex/"
git commit -m "feat: add KaTeX 0.16 bundle (local, no CDN)"
```

---

## Task 4: KaTeX in popup.html einbinden

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.html`

- [ ] **Step 1: KaTeX CSS im `<head>` vor `popup.css` einfügen**

Aktuelle Zeile in popup.html:
```html
  <link rel="stylesheet" href="popup.css">
```

Ersetzen durch:
```html
  <link rel="stylesheet" href="katex/katex.min.css">
  <link rel="stylesheet" href="popup.css">
```

- [ ] **Step 2: KaTeX JS-Dateien vor `popup.js` im `<body>` einfügen**

Aktuelle Zeile am Ende des `<body>`:
```html
  <script type="module" src="popup.js"></script>
```

Ersetzen durch:
```html
  <script src="katex/katex.min.js"></script>
  <script src="katex/auto-render.min.js"></script>
  <script type="module" src="popup.js"></script>
```

Wichtig: KaTeX-Scripts ohne `type="module"` — sie exportieren globale Variablen (`window.katex`, `window.renderMathInElement`), die popup.js dann nutzt.

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.html"
git commit -m "feat: load KaTeX CSS and JS in popup.html"
```

---

## Task 5: `renderMathInElement` nach Stream-Ende aufrufen

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: Helper-Funktion `renderKatex(bubble)` direkt nach `makeStreamFlusher` einfügen**

```js
function renderKatex(bubble) {
  if (!bubble || typeof window.renderMathInElement !== "function") return;
  try {
    window.renderMathInElement(bubble, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$",  right: "$",  display: false }
      ],
      throwOnError: false
    });
  } catch { /* ignore — fehlerhafte Formeln bleiben als Plain-Text */ }
}
```

- [ ] **Step 2: `renderKatex(aiBubble)` nach `flusher.finalize()` im ersten Streaming-Loop aufrufen**

Aktuell (nach Task 2):
```js
      flusher.finalize();
```

Ändern zu:
```js
      flusher.finalize();
      renderKatex(aiBubble);
```

- [ ] **Step 3: `renderKatex(webBubble)` nach `webFlusher.finalize()` im Web-Fallback-Loop aufrufen**

Aktuell:
```js
          webFlusher.finalize();
```

Ändern zu:
```js
          webFlusher.finalize();
          renderKatex(webBubble);
```

- [ ] **Step 4: Gemini (non-streaming) — `renderKatex` nach `renderMessage` für Gemini aufrufen**

Die Gemini-Antwort wird nicht gestreamt. Suche den Block (ca. Zeile 1018–1021):
```js
    if (providerId === "gemini") {
      fullResponse = await callGemini(messages, includeCtx);
      typingEl.classList.add("hidden");
      aiBubble = renderMessage("ai", fullResponse);
    } else {
```

Ändern zu:
```js
    if (providerId === "gemini") {
      fullResponse = await callGemini(messages, includeCtx);
      typingEl.classList.add("hidden");
      aiBubble = renderMessage("ai", fullResponse);
      renderKatex(aiBubble);
    } else {
```

Und analog für den Gemini-Pfad im Web-Fallback (ca. Zeile 1067–1070):
```js
        if (providerId === "gemini") {
          webResponse = await callGemini(webMessages, includeCtx, webContext);
          webBubble = renderMessage("ai", webResponse);
        } else {
```

Ändern zu:
```js
        if (providerId === "gemini") {
          webResponse = await callGemini(webMessages, includeCtx, webContext);
          webBubble = renderMessage("ai", webResponse);
          renderKatex(webBubble);
        } else {
```

- [ ] **Step 5: KaTeX CSS für Dark Mode anpassen — ans Ende des Dark-Mode-Blocks in popup.css anhängen**

```css
  /* KaTeX dark mode — override white backgrounds in formula elements */
  .katex-display {
    overflow-x: auto;
    overflow-y: hidden;
  }
```

(KaTeX-Text nutzt `currentColor` und erbt damit automatisch `--color-ink`; nur der Display-Block braucht `overflow: auto` für breite Formeln auf kleinem Popup.)

- [ ] **Step 6: Extension neu laden und mit einer Formel testen**

Eingabe in den Chat: `Erkläre die Normalverteilung mit Formel`

Erwartung: Die Formel `$$f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}$$` wird als gerenderte Mathe-Formel angezeigt, nicht als roher LaTeX-Text.

- [ ] **Step 7: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js" \
        "Safari AI Agent Extension/Resources/popup.css"
git commit -m "feat: render LaTeX formulas via KaTeX after stream completion"
```

---

## Abschluss

- [ ] **Finaler Smoke-Test:** Dark Mode umschalten, Formel schreiben, Streaming beobachten — alle drei Features gleichzeitig prüfen
- [ ] **Xcode Build:** Projekt kompilieren um sicherzustellen dass alle neuen Ressourcen im Bundle landen (`Cmd+B` in Xcode)
