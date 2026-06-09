---
name: page-context-mode
description: 3-state page context toggle (Auto/An/Aus) with hybrid page-relevance detection
metadata:
  type: project
---

# Page Context Mode — Design Spec

## Overview

Replace the existing binary `pageToggleEnabled` flag with a 3-state mode (`auto` | `on` | `off`) and a visible Segmented Control in the toolbar. In Auto mode, a hybrid detection pipeline decides per message whether to include the current page's content in the system prompt.

## UI — Segmented Control

The existing `page-toggle-btn` is replaced by a `<div id="page-ctx-control">` containing three `<button>` elements:

```
[ Auto ] [ Seite ] [ Aus ]
```

- **Auto** (default): hybrid detection decides per message
- **Seite**: page context always included
- **Aus**: page context never included

Placement: inside `.input-toolbar`, replacing the current page toggle button.  
The active segment gets a `.active` class; styling is theme-aware via CSS custom properties.  
The selected mode is persisted to `browser.storage.local` under the key `pageContextMode`.

## State

`pageToggleEnabled` (boolean) is removed.  
New module-level variable: `let pageContextMode = "auto"` — values: `"auto"` | `"on"` | `"off"`.

Loaded on init from storage, defaulting to `"auto"`.  
Saved immediately on each toggle click.

## Hybrid Detection (Auto mode only)

`shouldIncludePageContext(text: string): Promise<boolean>`

### Step 1 — Keyword check (sync, ~0 ms)

Returns `true` immediately if the input matches any of:

**Page-reference patterns (DE/EN):**
- `diese[rn]? (seite|artikel|text|inhalt|seite)`
- `was steht (hier|da|dort)`
- `(hier|da|dort) steht`
- `auf der seite`
- `this page`, `the article`, `what does it say`
- `den text`, `dem artikel`
- Imperative that imply "the current content": `fasse zusammen`, `übersetze (das|den|die)`, `erkläre mir das`, `summarize (this|the)`

Returns `false` immediately if the input is clearly general (e.g., no deictic pronouns, no imperative referring to a document).

Returns `null` if ambiguous — proceeds to Step 2.

### Step 2 — Mini KI-call (async, only when ambiguous)

Fires a non-streaming API call to the currently configured provider/model with:

```
system: "Antworte ausschließlich mit 'ja' oder 'nein', ohne Erklärung."
user:   "Bezieht sich diese Frage auf den Inhalt einer bestimmten Webseite, die der Nutzer gerade geöffnet hat? Frage: [user input]"
```

`max_tokens: 5`. Parses the response for `ja`/`yes` → `true`, else → `false`.  
On any error, falls back to `false` (treat as general question).

## Changes to `buildSystemPrompt`

`buildSystemPrompt` becomes `async buildSystemPrompt(includePageContext: boolean)`.  
The caller (`sendMessage`) resolves `shouldIncludePageContext` first, then passes the result.  
The `pageToggleEnabled` guard inside `buildSystemPrompt` is replaced by the `includePageContext` parameter.

## sendMessage changes

```js
// Before building messages:
const includeCtx = pageContextMode === "on"
  ? true
  : pageContextMode === "off"
    ? false
    : await shouldIncludePageContext(text);

const systemPrompt = await buildSystemPrompt(includeCtx);
```

## UI feedback

The segmented control visually reflects the current mode at all times.  
No extra loading spinner — the existing typing indicator covers the mini KI-call latency.

## Files changed

- `popup.html` — replace `page-toggle-btn` with `page-ctx-control` segmented control
- `popup.js` — `pageToggleEnabled` → `pageContextMode`, new `shouldIncludePageContext()`, async `buildSystemPrompt()`
- `popup.css` — segmented control styles (theme-aware)
