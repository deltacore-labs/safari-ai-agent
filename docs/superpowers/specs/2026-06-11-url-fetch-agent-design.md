# URL Fetch Agent — Design Spec
Date: 2026-06-11

## Overview

Enable the Safari AI Agent extension to automatically fetch the content of URLs typed into the chat, and intelligently follow relevant subpages on the same domain to answer the user's question.

## User Flow

1. User types a message containing a URL, e.g. `https://mpg-umstadt.de was sind aktuelle News?`
2. Extension detects the URL
3. Status message appears: "🔗 Seite wird geladen…"
4. Page is fetched in a background tab (invisible, closed immediately after read)
5. If the page has same-domain links and the question might need subpages:
   - Status message: "🔍 Relevante Unterseiten werden geladen…"
   - KI is called once to select relevant links (max 5)
   - Subpages are fetched in parallel (background tabs)
6. All content is merged into the page context
7. KI answers using the full fetched content

## Architecture

### `fetchUrlContent(url): Promise<{text, title, url} | null>`

- Opens a new background tab via `browser.tabs.create({ url, active: false })`
- Waits for the tab to finish loading via `browser.tabs.onUpdated` listener (timeout: 10s)
- Runs `browser.scripting.executeScript` to extract `document.body.innerText`, `document.title`, and all `<a href>` links on the page
- Closes the tab with `browser.tabs.remove(tabId)`
- Returns `{ text, title, url, links }` where `links` is an array of same-domain absolute URLs
- On timeout or error: closes the tab and returns `null`

### `selectRelevantLinks(rootContent, links, question): Promise<string[]>`

- Calls the configured AI provider with:
  - System: "Antworte ausschließlich mit einem JSON-Array von URLs, ohne Erklärung."
  - User: page title + truncated text (first 3000 chars) + link list + user question
- Parses the JSON array from the response
- Filters to only valid `http(s)://` URLs from the original `links` list
- Returns max 5 URLs
- Timeout: 5s — returns `[]` on failure

### `fetchMultiplePages(urls): Promise<{text, title, url}[]>`

- Fetches all URLs in parallel via `Promise.all(urls.map(fetchUrlContent))`
- Filters out null results

### Integration in `sendMessage()`

Before the existing AI call, after URL detection:

```
extractUrlFromText(text) → url?
  → fetchUrlContent(url) → rootContent
  → set currentPageContext = rootContent
  → rootContent.links non-empty?
    → selectRelevantLinks(rootContent, links, text) → selectedUrls
    → fetchMultiplePages(selectedUrls) → subpages
    → merge subpage texts into currentPageContext.text
```

### `extractUrlFromText(text): string | null`

- Regex: first `https?://[^\s]+` in the message
- Returns the URL with trailing punctuation stripped (`.`,`,`,`)`,`]` etc.)

## UI Feedback

Reuses the existing `renderContextModeNotice(label)` function for status messages:
- `"🔗 Seite wird geladen…"` — while fetching the root URL
- `"🔍 Relevante Unterseiten werden geladen…"` — while fetching subpages

## Limits & Safety

| Constraint | Value |
|---|---|
| Max subpages | 5 |
| Tab load timeout | 10s |
| Link selection AI timeout | 5s |
| Max text per page | 50,000 chars (existing limit) |
| Allowed URL schemes | `https://`, `http://` only |
| Same-domain rule | Only links with same hostname as root URL |

## What Does NOT Change

- The existing `fetchPageContent()` flow (reads the currently active tab) is unchanged
- `currentPageContext` format is unchanged: `{ text, title, url }`
- `pageContextUsedInConversation` flag logic is unchanged
- All existing providers (Anthropic, OpenAI, Gemini, Hyperspace, local) work as before

## Error Handling

- Tab fails to load → skip silently, continue with root content only
- Link selection AI call fails → skip subpages, continue with root only
- URL in message but page returns empty text → treat as no context (don't inject empty string)
- Non-http(s) URLs in message → not processed, passed as plain text to AI
