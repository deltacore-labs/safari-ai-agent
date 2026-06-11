# URL Fetch Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user types a URL in the chat, the extension automatically fetches the page content (and relevant subpages) in background tabs and uses it as context for the AI answer.

**Architecture:** Three new functions (`extractUrlFromText`, `fetchUrlContent`, `selectRelevantLinks`) are added to `popup.js`. `sendMessage()` is extended to call these before the AI request if a URL is detected. All tab operations use `browser.tabs` and `browser.scripting` APIs already available in the extension.

**Tech Stack:** JavaScript (browser extension), `browser.tabs`, `browser.scripting.executeScript`, existing provider fetch helpers in `popup.js`

---

### Task 1: `extractUrlFromText(text)`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` — add after `// ── Page Content Fetch ────` section (~line 894)

- [ ] **Step 1: Add `extractUrlFromText` function**

Insert this function directly after the `fetchPageContent` closing brace (after line ~922):

```js
// ── URL Extraction ────────────────────────────────────────────
function extractUrlFromText(text) {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) return null;
  return match[0].replace(/[.,)\]]+$/, "");
}
```

- [ ] **Step 2: Manually verify in browser console**

Open Safari extension popup, open browser console, paste:
```js
extractUrlFromText("schau mal https://mpg-umstadt.de/news was steht da?")
// Expected: "https://mpg-umstadt.de/news"

extractUrlFromText("kein link hier")
// Expected: null

extractUrlFromText("https://example.com.")
// Expected: "https://example.com"
```

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: add extractUrlFromText helper"
```

---

### Task 2: `fetchUrlContent(url)`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` — add after `extractUrlFromText`

- [ ] **Step 1: Add `fetchUrlContent` function**

Insert directly after `extractUrlFromText`:

```js
// ── Background Tab Fetch ──────────────────────────────────────
async function fetchUrlContent(url) {
  let tabId = null;
  try {
    const tab = await browser.tabs.create({ url, active: false });
    tabId = tab.id;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 10000);
      function onUpdated(id, info) {
        if (id !== tabId) return;
        if (info.status === "complete") {
          clearTimeout(timer);
          browser.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      }
      browser.tabs.onUpdated.addListener(onUpdated);
    });

    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        const rawText = document.body?.innerText ?? "";
        const rootHost = location.hostname;
        const links = Array.from(document.querySelectorAll("a[href]"))
          .map(a => {
            try { return new URL(a.href).href; } catch { return null; }
          })
          .filter(href => {
            if (!href) return false;
            if (!/^https?:\/\//.test(href)) return false;
            try { return new URL(href).hostname === rootHost; } catch { return false; }
          });
        const uniqueLinks = [...new Set(links)];
        return {
          text: rawText.length > 50000 ? rawText.slice(0, 50000) + "\n...[truncated]" : rawText,
          title: document.title,
          url: location.href,
          links: uniqueLinks
        };
      }
    });

    const data = results?.[0]?.result;
    if (!data || !data.text.trim()) return null;
    return data;
  } catch {
    return null;
  } finally {
    if (tabId !== null) {
      try { await browser.tabs.remove(tabId); } catch { /* ignore */ }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: add fetchUrlContent (background tab fetch)"
```

---

### Task 3: `selectRelevantLinks(rootContent, links, question)`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` — add after `fetchUrlContent`

- [ ] **Step 1: Add `selectRelevantLinks` function**

Insert directly after `fetchUrlContent`:

```js
// ── Relevant Link Selection ───────────────────────────────────
async function selectRelevantLinks(rootContent, links, question) {
  if (!links || links.length === 0) return [];

  const providerId = settings.provider;
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return [];

  const systemMsg = "Antworte ausschließlich mit einem JSON-Array von URLs, ohne Erklärung. Beispiel: [\"https://example.com/news\"]";
  const linkList = links.slice(0, 50).join("\n");
  const userMsg = `Seite: ${rootContent.title}\nURL: ${rootContent.url}\n\nSeiteninhalt (Auszug):\n${rootContent.text.slice(0, 3000)}\n\nVerfügbare Links auf der Seite:\n${linkList}\n\nNutzerfrage: ${question}\n\nWelche dieser Links (maximal 5) sind am relevantesten um die Frage zu beantworten?`;

  const timeout = new Promise(resolve => setTimeout(() => resolve([]), 5000));

  try {
    let fetchPromise;

    if (providerId === "anthropic") {
      fetchPromise = fetch(PROVIDERS.anthropic.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-allow-browser": "true"
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          system: systemMsg,
          messages: [{ role: "user", content: userMsg }]
        })
      }).then(r => r.json()).then(json => {
        const text = json.content?.[0]?.text ?? "[]";
        const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
        return parsed.filter(u => links.includes(u)).slice(0, 5);
      });
    } else if (providerId === "gemini") {
      const url = PROVIDERS.gemini.baseUrl.replace("{model}", model) + `?key=${settings.apiKey}`;
      fetchPromise = fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userMsg }] }],
          systemInstruction: { parts: [{ text: systemMsg }] },
          generationConfig: { maxOutputTokens: 300 }
        })
      }).then(r => r.json()).then(json => {
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
        const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
        return parsed.filter(u => links.includes(u)).slice(0, 5);
      });
    } else {
      const url = (providerId === "local" || providerId === "hyperspace")
        ? settings.baseUrl.replace(/\/$/, "") + "/chat/completions"
        : PROVIDERS.openai.baseUrl;
      const headers = { "Content-Type": "application/json" };
      if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;
      fetchPromise = fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 300,
          messages: [
            { role: "system", content: systemMsg },
            { role: "user", content: userMsg }
          ]
        })
      }).then(r => r.json()).then(json => {
        const text = json.choices?.[0]?.message?.content ?? "[]";
        const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
        return parsed.filter(u => links.includes(u)).slice(0, 5);
      });
    }

    return await Promise.race([fetchPromise, timeout]);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: add selectRelevantLinks (AI-driven subpage selection)"
```

---

### Task 4: Integrate into `sendMessage()`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` — inside `sendMessage()`, in the `try` block before `const includeCtx = ...` (~line 1562)

- [ ] **Step 1: Add URL fetch block into `sendMessage()`**

Find this exact block in `sendMessage()`:

```js
  try {
    const includeCtx = pageContextMode === "on"
```

Replace with:

```js
  try {
    // ── URL Fetch Agent ───────────────────────────────────────
    const detectedUrl = pageContextMode !== "off" ? extractUrlFromText(text) : null;
    if (detectedUrl) {
      renderContextModeNotice("🔗 Seite wird geladen…");
      scrollToBottom();
      const rootContent = await fetchUrlContent(detectedUrl);
      if (rootContent) {
        if (rootContent.links && rootContent.links.length > 0) {
          renderContextModeNotice("🔍 Relevante Unterseiten werden geladen…");
          scrollToBottom();
          const selectedUrls = await selectRelevantLinks(rootContent, rootContent.links, text);
          if (selectedUrls.length > 0) {
            const subpages = (await Promise.all(selectedUrls.map(fetchUrlContent))).filter(Boolean);
            if (subpages.length > 0) {
              rootContent.text += "\n\n" + subpages
                .map(p => `---\n${p.title}\n${p.url}\n${p.text}`)
                .join("\n\n");
            }
          }
        }
        currentPageContext = { text: rootContent.text, title: rootContent.title, url: rootContent.url };
        pageContextUsedInConversation = true;
      }
    }
    // ─────────────────────────────────────────────────────────

    const includeCtx = pageContextMode === "on"
```

- [ ] **Step 2: Build & test in Xcode**

Build and run the extension in Xcode (⌘R). In Safari:
1. Open the extension popup on any page
2. Type: `https://example.com was steht auf dieser seite?`
3. Expected:
   - "🔗 Seite wird geladen…" notice appears briefly
   - AI answers with the actual content of example.com (short page with title "Example Domain")

- [ ] **Step 3: Test subpage flow**

In Safari popup, type:
`https://mpg-umstadt.de was sind aktuelle News?`

Expected:
- "🔗 Seite wird geladen…" then "🔍 Relevante Unterseiten werden geladen…" notices appear
- AI answers with actual news content from the school website (not hallucinated world news)

- [ ] **Step 4: Test error case — bad URL**

Type: `https://diese-url-existiert-garantiert-nicht-xyz123.de was steht da?`

Expected:
- "🔗 Seite wird geladen…" appears briefly
- No crash, no error message
- AI answers normally (without page context, since fetch returned null)

- [ ] **Step 5: Test no-URL message still works**

Type any normal message without URL: `was ist die hauptstadt von frankreich?`

Expected:
- No "🔗 Seite wird geladen…" notice
- Normal AI response

- [ ] **Step 6: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat: URL fetch agent — auto-fetch URLs typed in chat"
```
