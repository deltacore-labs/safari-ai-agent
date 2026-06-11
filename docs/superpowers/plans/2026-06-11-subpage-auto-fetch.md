# Subpage Auto-Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically load relevant subpages of the current website when the user asks a question that requires subpage content (e.g. "hole den Artikel"), using a staged trigger: keyword check first, then AI classification.

**Architecture:** All changes are confined to `popup.js`. Three additions: (1) extend `fetchPageContent` to store same-domain links in `currentPageContext`; (2) add `shouldLoadSubpages` + `classifySubpageNeed` functions for the staged trigger logic; (3) insert a new auto-fetch block in `sendMessage` between the existing URL-fetch block and the `shouldIncludePageContext` call.

**Tech Stack:** Safari Web Extension (MV3), existing `fetchUrlContent` + `selectRelevantLinks` functions (already in popup.js), browser.scripting.executeScript.

---

## File Structure

Only one file changes:

| File | Change |
|------|--------|
| `Safari AI Agent Extension/Resources/popup.js` | Add `SUBPAGE_KEYWORDS_RE` constant, extend `fetchPageContent`, add `shouldLoadSubpages`, add `classifySubpageNeed`, extend `sendMessage` |

---

## Task 1: Extend `fetchPageContent` to store links

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (~line 896)

`fetchPageContent` currently stores `{ text, title, url }` in `currentPageContext`. It needs to also extract and store same-domain links so the subpage fetch can use them.

- [ ] **Step 1: Read the current `fetchPageContent` function**

Open `Safari AI Agent Extension/Resources/popup.js` and read lines 896–923. The function currently calls `browser.scripting.executeScript` with a `func` that returns `{ text, title, url }`. You need to extend that `func` to also return `links`.

- [ ] **Step 2: Replace the executeScript func inside `fetchPageContent`**

Find this exact code (lines ~902–912):
```js
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const rawText = document.body?.innerText ?? "";
        return {
          text: rawText.length > 50000 ? rawText.slice(0, 50000) + "\n...[truncated]" : rawText,
          title: document.title,
          url: window.location.href
        };
      }
    });
```

Replace with:
```js
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const rawText = document.body?.innerText ?? "";
        const rootHost = location.hostname;
        const links = Array.from(document.querySelectorAll("a[href]"))
          .map(a => { try { return new URL(a.href).href; } catch { return null; } })
          .filter(href => {
            if (!href) return false;
            if (!/^https?:\/\//.test(href)) return false;
            try { return new URL(href).hostname === rootHost; } catch { return false; }
          });
        return {
          text: rawText.length > 50000 ? rawText.slice(0, 50000) + "\n...[truncated]" : rawText,
          title: document.title,
          url: window.location.href,
          links: [...new Set(links)]
        };
      }
    });
```

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat(subpage): fetchPageContent now stores same-domain links in currentPageContext"
```

---

## Task 2: Add `SUBPAGE_KEYWORDS_RE` constant and `classifySubpageNeed` function

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (~line 925, after `extractUrlFromText`)

- [ ] **Step 1: Add the keyword regex constant and `classifySubpageNeed` function**

Find this comment in popup.js (line ~925):
```js
// ── URL Extraction ────────────────────────────────────────────
```

Insert the following block BEFORE that comment:
```js
// ── Subpage Auto-Fetch ────────────────────────────────────────
const SUBPAGE_KEYWORDS_RE = /\b(hole|hol\b|öffne|zeig|lies|lese|fetch|load|open|show|artikel|article|unterseite|subpage|inhalt|content|details|mehr\s+dazu|vollständig|complete|was\s+steht\s+(im|in\s+dem|dort|da))\b/i;

async function classifySubpageNeed(text) {
  const providerId = settings.provider;
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return false;
  if (!settings.apiKey && providerId !== "local") return false;
  if ((providerId === "local" || providerId === "hyperspace") && !settings.baseUrl) return false;

  const systemMsg = "Antworte ausschließlich mit 'ja' oder 'nein', ohne Erklärung.";
  const userMsg = `Bezieht sich diese Frage auf den Detailinhalt eines verlinkten Artikels oder einer Unterseite? Frage: ${text}`;

  const timeout = new Promise(resolve => setTimeout(() => resolve(false), 3000));

  try {
    let classifyPromise;

    if (providerId === "anthropic") {
      classifyPromise = fetch(PROVIDERS.anthropic.baseUrl, {
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
      }).then(r => r.json()).then(json => {
        const answer = (json.content?.[0]?.text ?? "").toLowerCase();
        return answer.includes("ja") || answer.includes("yes");
      });
    } else if (providerId === "gemini") {
      const url = PROVIDERS.gemini.baseUrl.replace("{model}", model) + `?key=${settings.apiKey}`;
      classifyPromise = fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userMsg }] }],
          systemInstruction: { parts: [{ text: systemMsg }] },
          generationConfig: { maxOutputTokens: 5 }
        })
      }).then(r => r.json()).then(json => {
        const answer = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").toLowerCase();
        return answer.includes("ja") || answer.includes("yes");
      });
    } else {
      const url = (providerId === "local" || providerId === "hyperspace")
        ? settings.baseUrl.replace(/\/$/, "") + "/chat/completions"
        : PROVIDERS.openai.baseUrl;
      classifyPromise = fetch(url, {
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
      }).then(r => r.json()).then(json => {
        const answer = (json.choices?.[0]?.message?.content ?? "").toLowerCase();
        return answer.includes("ja") || answer.includes("yes");
      });
    }

    return await Promise.race([classifyPromise, timeout]);
  } catch {
    return false;
  }
}

async function shouldLoadSubpages(text) {
  if (SUBPAGE_KEYWORDS_RE.test(text)) return true;
  return await classifySubpageNeed(text);
}

```

- [ ] **Step 2: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat(subpage): add SUBPAGE_KEYWORDS_RE, classifySubpageNeed, shouldLoadSubpages"
```

---

## Task 3: Insert subpage auto-fetch block in `sendMessage`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js` (~line 1732)

- [ ] **Step 1: Find the insertion point in `sendMessage`**

In `sendMessage`, find this exact closing block of the URL-fetch agent (lines ~1732–1733):
```js
    }
    // ─────────────────────────────────────────────────────────

    const includeCtx = pageContextMode === "on"
```

- [ ] **Step 2: Insert the subpage auto-fetch block between those two sections**

Replace:
```js
    }
    // ─────────────────────────────────────────────────────────

    const includeCtx = pageContextMode === "on"
```

With:
```js
    }
    // ─────────────────────────────────────────────────────────

    // ── Subpage Auto-Fetch ────────────────────────────────────
    if (!detectedUrl && currentPageContext?.links?.length > 0 && pageContextMode !== "off") {
      const shouldLoad = await shouldLoadSubpages(text);
      if (shouldLoad) {
        renderContextModeNotice("🔗 Unterseiten werden geladen…");
        scrollToBottom();
        const selectedUrls = await selectRelevantLinks(currentPageContext, currentPageContext.links, text);
        if (selectedUrls.length > 0) {
          const subpages = (await Promise.all(selectedUrls.map(fetchUrlContent))).filter(Boolean);
          if (subpages.length > 0) {
            const subText = subpages
              .map(p => `---\n${p.title}\n${p.url}\n${p.text.slice(0, 3000)}`)
              .join("\n\n");
            currentPageContext = { ...currentPageContext, text: currentPageContext.text + "\n\n" + subText };
            renderContextModeNotice(`✅ ${subpages.length} Unterseite${subpages.length > 1 ? "n" : ""} geladen`);
            scrollToBottom();
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────

    const includeCtx = pageContextMode === "on"
```

- [ ] **Step 3: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat(subpage): auto-fetch subpages in sendMessage when user asks about linked content"
```

---

## Task 4: Manual smoke test

**Files:** None (manual test in Safari)

- [ ] **Step 1: Build in Xcode**

Open Xcode, press Cmd+R. No compile errors expected (JS has no build step).

- [ ] **Step 2: Open a page with links in Safari**

Navigate to `https://mpg-umstadt.de` (or any news/article listing page).

- [ ] **Step 3: Open popup and ask about a linked article**

Open the extension popup. Type: `hole den Artikel über die Waldexkursion`

Expected:
- Status notice appears: "🔗 Unterseiten werden geladen…"
- Then: "✅ 1 Unterseite geladen" (or similar)
- AI answers with content from the article page

- [ ] **Step 4: Test keyword trigger**

Type: `zeig mir die Details zum Sommerkonzert`

Expected: Same flow — subpages loaded automatically.

- [ ] **Step 5: Test AI classification fallback**

Type a question that doesn't contain keywords but clearly needs a subpage:
`Was hat die Klasse 8b auf ihrer Studienfahrt erlebt?`

Expected: AI classification fires, subpages loaded.

- [ ] **Step 6: Test non-subpage question**

Type: `Was ist das Motto der Schule?`

Expected: No "Unterseiten werden geladen" notice — answer comes from the main page context already loaded.

- [ ] **Step 7: Test with pageContextMode off**

Set context mode to "Aus" in the popup header. Ask a subpage question.

Expected: No subpage loading, no notice.

- [ ] **Step 8: Final commit if no fixes needed**

```bash
git add -A
git commit -m "test: subpage auto-fetch smoke test passes"
```
