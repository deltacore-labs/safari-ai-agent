# Web Search Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the main AI model signals uncertainty about current information, automatically query Perplexity via Hyperspace and re-answer with live web context injected into the system prompt.

**Architecture:** After a streaming response completes, run a regex uncertainty check on the full response text. If matched, fetch web context via `sonar` model on Hyperspace, then call the main model a second time with that context appended to the system prompt. The first uncertain answer stays in chat; the enriched second answer appears below it with a "Websuche durchgeführt" indicator.

**Tech Stack:** Vanilla JS (extension popup), browser WebExtension APIs, Hyperspace/LiteLLM proxy at `settings.baseUrl`

---

## File Map

- Modify: `Safari AI Agent Extension/Resources/popup.js`
  - Add `uncertaintyCheck(text)` — regex function (~650 line area, after `shouldIncludePageContext`)
  - Add `fetchWebContext(question)` — fetch sonar via Hyperspace (~650 line area, after `uncertaintyCheck`)
  - Modify `buildSystemPrompt(includePageContext, webContext)` — add optional third parameter (~line 649)
  - Modify `sendMessage()` — add post-response web fallback logic (~line 913, after `chatHistory.push`)

---

## Task 1: Add `uncertaintyCheck(text)`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (after `shouldIncludePageContext` function, ~line 646)

- [ ] **Step 1: Add the function after `shouldIncludePageContext`**

Find this line in popup.js (~line 646):
```js
async function shouldIncludePageContext(text) {
  if (!currentPageContext || currentPageContext._debugError) return false;
  if (keywordCheck(text)) return true;
  return await classifyWithAI(text);
}
```

Insert this block immediately after it:

```js
// ── Uncertainty Detection ─────────────────────────────────────
const UNCERTAINTY_RE = /nach meinem (trainingsstand|wissensstand)|ich wei[sß] (es )?nicht|kann ich nicht bestätigen|nicht (ganz |völlig )?sicher|mein wissen reicht bis|ich habe keinen zugriff|kann ich nicht mit sicherheit|as of my (knowledge|training)|i (don't|do not|cannot|can't) (know|confirm|access|verify)|my (knowledge|training) (cutoff|ends|is limited)|i'?m not (sure|certain)|i have no (access|information)/i;

function uncertaintyCheck(text) {
  return UNCERTAINTY_RE.test(text);
}
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: add uncertaintyCheck regex for web search fallback"
```

---

## Task 2: Add `fetchWebContext(question)`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (after `uncertaintyCheck`, ~line 658)

- [ ] **Step 1: Add the function immediately after `uncertaintyCheck`**

```js
// ── Web Context Fetch (Perplexity via Hyperspace) ─────────────
async function fetchWebContext(question) {
  if (!settings.baseUrl) return null;
  const url = settings.baseUrl.replace(/\/$/, "") + "/chat/completions";
  try {
    const headers = { "Content-Type": "application/json" };
    if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "sonar",
        max_tokens: 1024,
        stream: false,
        messages: [{ role: "user", content: question }]
      })
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: add fetchWebContext via Hyperspace sonar model"
```

---

## Task 3: Extend `buildSystemPrompt` with `webContext` parameter

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (~line 649)

- [ ] **Step 1: Replace the existing `buildSystemPrompt` function**

Current code:
```js
function buildSystemPrompt(includePageContext = false) {
  const base = settings.systemPrompt?.trim() ||
    "Du bist ein hilfreicher KI-Assistent.";

  const now = new Date();
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const withDate = `${base}\n\nAktuelles Datum: ${dateStr}.`;

  if (!includePageContext || !currentPageContext || currentPageContext._debugError) return withDate;

  return [
    withDate,
    "",
    `Der Nutzer befindet sich auf: ${currentPageContext.title}`,
    `URL: ${currentPageContext.url}`,
    `Seiteninhalt:\n${currentPageContext.text}`
  ].join("\n");
}
```

Replace with:
```js
function buildSystemPrompt(includePageContext = false, webContext = null) {
  const base = settings.systemPrompt?.trim() ||
    "Du bist ein hilfreicher KI-Assistent.";

  const now = new Date();
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let prompt = `${base}\n\nAktuelles Datum: ${dateStr}.`;

  if (webContext) {
    prompt += `\n\nAktuelle Informationen aus dem Internet (via Websuche):\n<webcontext>\n${webContext}\n</webcontext>\nNutze diese Informationen bevorzugt gegenüber deinem Trainingswissen.`;
  }

  if (!includePageContext || !currentPageContext || currentPageContext._debugError) return prompt;

  return [
    prompt,
    "",
    `Der Nutzer befindet sich auf: ${currentPageContext.title}`,
    `URL: ${currentPageContext.url}`,
    `Seiteninhalt:\n${currentPageContext.text}`
  ].join("\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: extend buildSystemPrompt with optional webContext param"
```

---

## Task 4: Wire web fallback into `sendMessage`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (~line 914)

- [ ] **Step 1: Replace the post-response block in `sendMessage`**

Find this block inside the `try` of `sendMessage` (after the streaming loop, ~line 914):
```js
    chatHistory.push({ role: "assistant", content: fullResponse });
    await saveHistory(chatHistory);
```

Replace with:
```js
    chatHistory.push({ role: "assistant", content: fullResponse });
    await saveHistory(chatHistory);

    // Web search fallback — only runs once per user message
    if (fullResponse && uncertaintyCheck(fullResponse) && settings.baseUrl) {
      renderContextModeNotice("Websuche wird durchgeführt…");
      typingEl.classList.remove("hidden");
      scrollToBottom();

      const webContext = await fetchWebContext(text);

      typingEl.classList.add("hidden");

      if (webContext) {
        renderContextModeNotice("Websuche durchgeführt");

        let webMessages;
        const webSystemPrompt = buildSystemPrompt(includeCtx, webContext);
        if (providerId === "anthropic" || providerId === "gemini") {
          webMessages = chatHistory.map(m => ({ role: m.role, content: m.content }));
        } else {
          webMessages = [
            { role: "system", content: webSystemPrompt },
            ...chatHistory.map(m => ({ role: m.role, content: m.content }))
          ];
        }

        let webBubble = null;
        let webResponse = "";

        if (providerId === "gemini") {
          webResponse = await callGemini(webMessages, includeCtx, webContext);
          webBubble = renderMessage("ai", webResponse);
        } else {
          const webGenerator = providerId === "anthropic"
            ? streamAnthropic(webMessages, includeCtx, webContext)
            : streamOpenAI(webMessages);

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
        }

        if (webResponse) {
          chatHistory.push({ role: "assistant", content: webResponse });
          await saveHistory(chatHistory);
        }
      }
    }
```

> **Note:** `text` is the original user input captured at the top of `sendMessage`. `includeCtx` is already in scope from the earlier `shouldIncludePageContext` call. The `typingEl` variable is also already in scope.

- [ ] **Step 2: Extend `streamAnthropic` and `callGemini` to accept `webContext`**

`streamAnthropic` currently calls `buildSystemPrompt(includeCtx)`. It needs to accept and forward `webContext`.

Find (~line 740):
```js
async function* streamAnthropic(messages, includeCtx = false) {
  const systemPrompt = buildSystemPrompt(includeCtx);
```

Replace with:
```js
async function* streamAnthropic(messages, includeCtx = false, webContext = null) {
  const systemPrompt = buildSystemPrompt(includeCtx, webContext);
```

Find `callGemini` (~line 779):
```js
async function callGemini(messages, includeCtx = false) {
  const systemPrompt = buildSystemPrompt(includeCtx);
```

Replace with:
```js
async function callGemini(messages, includeCtx = false, webContext = null) {
  const systemPrompt = buildSystemPrompt(includeCtx, webContext);
```

- [ ] **Step 3: Verify `renderContextModeNotice` is already defined**

The function exists at ~line 517 in popup.js:
```js
function renderContextModeNotice(label) {
  removeEmptyState();
  const notice = document.createElement("div");
  notice.className = "model-tag";
  notice.textContent = `Seitenkontext: ${label}`;
  document.getElementById("messages").appendChild(notice);
  scrollToBottom();
}
```

The text currently reads `Seitenkontext: ${label}` — for web search notices this would show "Seitenkontext: Websuche durchgeführt" which is misleading. Update it to just render the label directly:

Find:
```js
function renderContextModeNotice(label) {
  removeEmptyState();
  const notice = document.createElement("div");
  notice.className = "model-tag";
  notice.textContent = `Seitenkontext: ${label}`;
  document.getElementById("messages").appendChild(notice);
  scrollToBottom();
}
```

Replace with:
```js
function renderContextModeNotice(label) {
  removeEmptyState();
  const notice = document.createElement("div");
  notice.className = "model-tag";
  notice.textContent = label;
  document.getElementById("messages").appendChild(notice);
  scrollToBottom();
}
```

> **Note:** The existing callers in the page-context segmented control pass `MODE_LABELS` like `"Auto"`, `"Seite"`, `"Aus"` — they will need to be updated to include the prefix themselves now. Find in `init()` (~line 1037):

```js
const MODE_LABELS = { auto: "Auto", on: "Seite", off: "Aus" };
renderContextModeNotice(MODE_LABELS[pageContextMode] ?? pageContextMode);
```

Replace with:
```js
const MODE_LABELS = { auto: "Seitenkontext: Auto", on: "Seitenkontext: Seite", off: "Seitenkontext: Aus" };
renderContextModeNotice(MODE_LABELS[pageContextMode] ?? pageContextMode);
```

- [ ] **Step 4: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: web search fallback — auto re-query with Perplexity on uncertainty"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Build and run in Xcode**

Open Xcode, build the Safari AI Agent target (⌘B), then run it (⌘R). Enable the extension in Safari → Settings → Extensions.

- [ ] **Step 2: Test uncertainty trigger**

With Hyperspace running and `sonar` available, ask: `"Wer ist aktuell der Präsident der USA?"` using a model that doesn't have 2026 knowledge (e.g. Claude Haiku).

Expected:
1. First AI bubble appears with an uncertain answer
2. "Websuche wird durchgeführt…" tag appears below
3. "Websuche durchgeführt" tag replaces it
4. Second AI bubble appears with a current, sourced answer

- [ ] **Step 3: Test silent fallback (Hyperspace not running)**

Stop Hyperspace. Ask the same question.

Expected: Only the first (uncertain) answer appears. No error. No crash.

- [ ] **Step 4: Test non-uncertain question**

Ask `"Was ist 2 + 2?"`. Expected: Normal answer, no web search tags, no second bubble.
