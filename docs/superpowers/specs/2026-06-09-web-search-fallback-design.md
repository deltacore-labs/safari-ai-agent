# Web Search Fallback — Design Spec

**Date:** 2026-06-09  
**Status:** Approved

## Summary

When the configured AI model signals uncertainty about current information (via recognizable phrases in its response), the extension automatically queries Perplexity via the local Hyperspace proxy, then asks the main model again with the retrieved web context injected into the system prompt. The user sees a chat indicator when this happens.

---

## Architecture & Data Flow

```
User sends message
       │
       ▼
Main model answers (streaming, as today)
       │
       ▼
uncertaintyCheck(response)   ← regex on completed response text
       │ matched
       ▼
Render chat tag: "Websuche durchgeführt"
       │
       ▼
fetchWebContext(originalQuestion)
  → POST Hyperspace /chat/completions, model: "sonar"
  → non-streaming, max_tokens: 1024
  → returns plain text
       │
       ▼
buildSystemPrompt(includePageContext, webContext)
  → injects web context block into system prompt
       │
       ▼
Main model answers again (streaming)
  → new AI bubble, first answer stays visible above
```

Page context and web context are independent and can both be active at the same time.

---

## Components

### `uncertaintyCheck(text: string): boolean`

Regex match against the completed model response. Triggers on:

- German: `nach meinem trainingsstand`, `wissensstand`, `ich weiß nicht`, `kann ich nicht bestätigen`, `nicht sicher`, `mein wissen reicht bis`, `ich habe keinen zugriff`, `kann ich nicht mit sicherheit`
- English: `as of my (knowledge|training)`, `i (don't|do not|cannot|can't) (know|confirm|access|verify)`, `my (knowledge|training) (cutoff|ends|is limited)`, `i'm not (sure|certain)`, `i have no (access|information)`

Case-insensitive. Returns `true` if any phrase matches.

### `fetchWebContext(question: string): Promise<string | null>`

- Endpoint: `settings.baseUrl.replace(/\/$/, "") + "/chat/completions"` (Hyperspace)
- Model: `"sonar"` (hardcoded — Perplexity's web-search model on LiteLLM)
- Request body: `{ model: "sonar", max_tokens: 1024, stream: false, messages: [{ role: "user", content: question }] }`
- Auth: `Authorization: Bearer ${settings.apiKey}` only if `settings.apiKey` is set
- Returns: `json.choices[0].message.content` or `null` on any error
- No retry logic — if Perplexity is unavailable, the flow silently falls back (first answer stays, no second call)

### `buildSystemPrompt(includePageContext, webContext)`

Extended signature. When `webContext` is provided and non-empty, appends:

```
Aktuelle Informationen aus dem Internet (via Websuche):
<webcontext>
{webContext}
</webcontext>
Nutze diese Informationen bevorzugt gegenüber deinem Trainingswissen.
```

Page context block (if active) is appended after the web context block.

### Chat Indicator

Same `model-tag` div used for model changes and page context notices.  
Text: `Websuche durchgeführt`  
No emoji — consistent with existing indicators.

---

## Constraints

- Only triggers when `settings.provider === "hyperspace"` or `settings.baseUrl` is set (Perplexity needs the local proxy). If the user is on direct Anthropic/OpenAI/Gemini without Hyperspace, `fetchWebContext` returns `null` silently and no second call is made.
- The first (uncertain) answer is **kept** in the chat — the web-enriched answer appears as a new bubble directly below, not as a replacement. This makes the flow transparent.
- `fetchWebContext` is only called once per user message, even if the second answer also contains uncertainty phrases (no infinite loop).
- No new settings UI required — Perplexity model name (`"sonar"`) is hardcoded, routed through the existing Hyperspace base URL.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Hyperspace not running | `fetchWebContext` returns `null`, first answer stays, no second call |
| `sonar` model not available on LiteLLM | Same — `null` return, silent fallback |
| `uncertaintyCheck` false positive | Second call happens unnecessarily, but answer is still correct |
| `uncertaintyCheck` false negative | No web lookup, user gets the uncertain first answer (same as today) |

---

## Out of Scope

- No UI toggle to enable/disable web fallback (always on when Hyperspace is reachable)
- No display of Perplexity citations/sources in the UI
- No caching of web context across messages
