# Dynamic Model Fetch — Design Spec

## Problem

The current settings panel has a hardcoded static model list for OpenAI, and a plain text input for Local/Hyperspace providers. Users have no way to see which models are actually available on their configured endpoint. For local providers (Ollama, LM Studio) in particular, the available models differ per machine.

## Goal

When a user selects a provider or finishes typing a Base URL, the extension automatically fetches the available models from that provider's API and populates the model dropdown — no manual button needed.

---

## Trigger Logic

| Event | Action |
|-------|--------|
| Provider dropdown changes | Immediately fetch models (uses saved API key + base URL) |
| Base URL input stops changing (300ms debounce) | Fetch models for current provider |
| API key input stops changing (300ms debounce) | Re-fetch models if provider requires a key |

**Anthropic and Gemini** have no public `/models` endpoint (or require special auth) — they skip the fetch and always use the static list. The fetch function returns `null` for these, and the static list is used as fallback.

---

## Fetch Endpoints per Provider

| Provider | Endpoint | Auth | Response path |
|----------|----------|------|---------------|
| OpenAI | `GET https://api.openai.com/v1/models` | `Authorization: Bearer {apiKey}` | `data[].id` — filter: keep only ids containing `"gpt"` |
| Anthropic | *(no fetch)* | — | Static list: `["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]` |
| Gemini | *(no fetch)* | — | Static list: `["gemini-1.5-pro", "gemini-1.5-flash"]` |
| Local (Ollama/LM Studio) | `GET {baseUrl}/models` | `Authorization: Bearer {apiKey}` (optional) | `data[].id` — all models, no filter |
| Hyperspace | `GET {baseUrl}/models` | `Authorization: Bearer {apiKey}` | `data[].id` — all models, no filter |

**OpenAI filter rationale:** The `/v1/models` endpoint returns ~50+ models including embedding, TTS, and image models. Filtering to only `gpt-` names gives a clean list of chat-capable models.

---

## UI States

### Loading state
- Model `<select>` is disabled
- A small inline spinner `⟳` appears to the right of the dropdown label
- Placeholder option: `"Modelle werden geladen…"`

### Success state
- `<select>` re-enabled, populated with fetched models
- First model in list is selected by default
- If the previously saved model is in the new list, it is pre-selected instead
- Spinner removed

### Error state
- `<select>` is empty and disabled
- Small red error text beneath the dropdown: `"Modelle konnten nicht geladen werden"`
- No fallback static list (per user requirement)

### No-key / no-URL state (provider requires one but it's empty)
- For providers that need a key/URL: skip fetch, show empty dropdown with hint: `"API-Key eingeben um Modelle zu laden"` (OpenAI/Anthropic/Gemini/Hyperspace) or `"Base URL eingeben um Modelle zu laden"` (Local)
- No error shown — it's expected

---

## Code Changes — `popup.js` only

### New: `debounce(fn, ms)`
Standard debounce utility. Used for Base URL and API key input listeners.

### New: `fetchModelsForProvider(providerId)` → `Promise<string[] | null>`
```
- openai:     GET /v1/models with apiKey → filter data[].id containing "gpt" → sorted
- anthropic:  return null (caller uses static list)
- gemini:     return null (caller uses static list)
- local:      GET {baseUrl}/models with optional apiKey → return data[].id (all)
- hyperspace: GET {baseUrl}/models with apiKey → return data[].id (all)
```
Returns `null` on any network error, non-200 response, or missing required config (no apiKey for OpenAI, no baseUrl for Local/Hyperspace).

### Modified: `populateModelDropdown(providerId)` → becomes `async`
New flow:
1. Show loading state (disable select, spinner, placeholder option)
2. Call `fetchModelsForProvider(providerId)`
3. If `null` returned (Anthropic/Gemini or fetch failed with no prior attempt): check if it's a static-list provider → populate with static. Otherwise show error state.
4. If `[]` returned (fetch succeeded but empty list): show error "Keine Modelle gefunden"
5. If `string[]` returned: populate dropdown, restore saved model if present

### Modified: `onProviderChange()`
Calls `await populateModelDropdown(providerId)` (already done, just now awaited).

### New listeners in `init()`
- `#base-url-input` → `input` event → debounced 300ms → `populateModelDropdown(currentProvider)`
- `#api-key-input` → `input` event → debounced 300ms → `populateModelDropdown(currentProvider)` (only if provider is openai/hyperspace)

### New: spinner CSS (inline in popup.css)
```css
.model-loading-spinner {
  display: inline-block;
  width: 12px; height: 12px;
  border: 1.5px solid var(--color-hairline);
  border-top-color: var(--color-fin-orange);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  vertical-align: middle;
  margin-left: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.model-fetch-error {
  font-size: 12px;
  color: var(--color-error);
  margin-top: 4px;
}
.model-fetch-hint {
  font-size: 12px;
  color: var(--color-ink-tertiary);
  margin-top: 4px;
}
```

### HTML change in `popup.html`
Add a label wrapper with spinner slot and error/hint paragraph after the model select:
```html
<section class="settings-section">
  <div class="settings-label-row">
    <label class="settings-label" for="model-select">Modell</label>
    <span id="model-spinner" class="model-loading-spinner" style="display:none"></span>
  </div>
  <select id="model-select" class="settings-select"></select>
  <input type="text" id="model-custom-input" class="settings-input" style="margin-top:8px;display:none"
         placeholder="Modellname, z.B. llama3">
  <p id="model-fetch-message" style="display:none"></p>
</section>
```

And a small CSS addition:
```css
.settings-label-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.settings-label-row .settings-label {
  margin-bottom: 0;
}
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Network offline | Error state: "Modelle konnten nicht geladen werden" |
| HTTP 401 (wrong API key) | Error state: "API-Key ungültig" |
| HTTP 404 (wrong Base URL) | Error state: "Base URL nicht gefunden" |
| HTTP other error | Error state: "Fehler {status}" |
| Empty Base URL for local | Hint: "Base URL eingeben um Modelle zu laden" |
| Empty API key for OpenAI | Hint: "API-Key eingeben um Modelle zu laden" |
| Fetch returns empty array | Error: "Keine Modelle gefunden" |

---

## Files Changed

| File | Change |
|------|--------|
| `Safari AI Agent Extension/Resources/popup.js` | `fetchModelsForProvider`, `debounce`, modify `populateModelDropdown` to async, add debounced listeners in `init` |
| `Safari AI Agent Extension/Resources/popup.html` | Add `#model-spinner`, `#model-fetch-message` elements |
| `Safari AI Agent Extension/Resources/popup.css` | Add `.model-loading-spinner`, `@keyframes spin`, `.model-fetch-error`, `.model-fetch-hint`, `.settings-label-row` |

---

## Self-Review

- No TBDs ✓
- Anthropic/Gemini skip-fetch is explicit and documented ✓
- Error states are specific (not generic "error occurred") ✓
- Debounce prevents spamming the API on every keystroke ✓
- Previously saved model is restored if still in list ✓
- `model-custom-input` (Local/Hyperspace free-text fallback) is kept but hidden when models fetch succeeds ✓
- No new external libraries ✓
