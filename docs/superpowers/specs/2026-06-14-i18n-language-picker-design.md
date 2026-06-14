# i18n / Language Picker — Design Spec

**Date:** 2026-06-14  
**Status:** Approved

## Summary

Add a language picker to the settings panel so users can switch the extension UI between German and English at runtime. Language preference is persisted in settings and takes effect instantly on save — no reload required.

---

## Approach

Custom JS dictionary (Option B): a `i18n.js` ES module holds all translations in a `TRANSLATIONS` object. DOM elements get `data-i18n*` attributes; `applyTranslations()` rewrites them whenever the language changes. This works at runtime without extension reload, and is the right choice because the `_locales` / `browser.i18n.getMessage()` system (Apple's recommended approach) cannot switch language at runtime.

---

## Architecture

### New file: `i18n.js`

A standalone ES module imported by both `popup.js` and `background.js`.

**Exports:**
- `TRANSLATIONS` — object `{ de: { key: string }, en: { key: string } }`
- `t(key, ...args)` — returns translated string for active language; `%1`, `%2` interpolation; falls back to `"de"` if key missing in active lang
- `setLanguage(lang)` — sets active language in module state
- `getLanguage()` — returns active language code (`"de"` | `"en"`)
- `applyTranslations(root?)` — walks the DOM from `root` (default: `document`) and applies all `data-i18n*` attributes

**Module state:** a single `let currentLang = "de"` variable. No external dependencies.

### Translation keys

All translatable strings get a flat snake_case key. Interpolated strings use `%1`, `%2` positional markers.

#### Popup UI strings

| Key | German | English |
|-----|--------|---------|
| `settings_title` | Einstellungen | Settings |
| `provider_label` | KI-Anbieter | AI Provider |
| `provider_local` | Lokal (Ollama / LM Studio) | Local (Ollama / LM Studio) |
| `base_url_label` | Base URL | Base URL |
| `api_key_label` | API-Key | API Key |
| `api_key_toggle_aria` | API-Key anzeigen/verbergen | Show/hide API key |
| `model_label` | Modell | Model |
| `model_loading` | Modelle werden geladen… | Loading models… |
| `model_reload_aria` | Modelle neu laden | Reload models |
| `system_prompt_label` | System Prompt | System Prompt |
| `system_prompt_optional` | (optional) | (optional) |
| `system_prompt_placeholder` | Du bist ein hilfreicher KI-Assistent… | You are a helpful AI assistant… |
| `language_label` | Sprache / Language | Sprache / Language |
| `data_label` | Daten | Data |
| `export_btn` | Exportieren | Export |
| `import_btn` | Importieren | Import |
| `clear_history_btn` | Verlauf löschen | Clear history |
| `save_settings_btn` | Einstellungen speichern | Save settings |
| `saved_confirm` | Gespeichert ✓ | Saved ✓ |
| `claude_config_badge` | Aus Claude Code konfiguriert | Configured from Claude Code |
| `page_ctx_auto_title` | Automatisch erkennen | Auto-detect |
| `page_ctx_on_title` | Seite immer einbeziehen | Always include page |
| `page_ctx_off_title` | Seite nie einbeziehen | Never include page |
| `page_ctx_btn_on` | Seite | Page |
| `page_ctx_btn_off` | Aus | Off |
| `history_aria` | Gesprächsverlauf | Conversation history |
| `history_search_placeholder` | Suchen… | Search… |
| `new_conversation_btn` | Neue Unterhaltung | New conversation |
| `new_chat_aria` | Neue Konversation | New conversation |
| `attach_aria` | Bild anhängen | Attach image |
| `input_placeholder` | Frage stellen… | Ask a question… |
| `input_aria` | Nachricht eingeben | Enter message |
| `send_aria` | Senden | Send |
| `stop_aria` | Abbrechen | Stop |
| `darkmode_aria` | Dark Mode umschalten | Toggle dark mode |
| `back_aria` | Zurück | Back |
| `image_preview_alt` | Anhang Vorschau | Attachment preview |
| `image_remove_aria` | Bild entfernen | Remove image |
| `empty_state_text` | Stelle mir eine Frage zu dieser Seite oder irgendeinem anderen Thema. | Ask me anything about this page or any other topic. |
| `pin_btn_unpin` | Lösen | Unpin |
| `pin_btn_pin` | Anpinnen | Pin |
| `copy_btn_title` | Kopieren | Copy |
| `copy_btn_done` | ✓ | ✓ |
| `code_copy_btn` | Kopieren | Copy |
| `no_model_selected` | Kein Modell ausgewählt | No model selected |
| `conv_title_fallback` | Unterhaltung | Conversation |
| `new_conv_title` | Neue Unterhaltung | New conversation |
| `imported_conv_title` | Importierte Unterhaltung | Imported conversation |
| `agent_section_label` | Agent | Agent |
| `agent_placeholder` | Aufgabe beschreiben, z.B. „Melde mich mit user@example.com an" | Describe task, e.g. "Log me in with user@example.com" |
| `agent_start_btn` | Starten | Start |
| `agent_stop_btn` | Stop | Stop |
| `agent_confirm_btn_yes` | Ausführen | Execute |
| `agent_confirm_btn_no` | Abbrechen | Cancel |
| `confirm_prefix` | Bestätigen: %1 | Confirm: %1 |
| `retry_btn` | ↻ Nochmal versuchen | ↻ Try again |
| `image_type_error` | Nur PNG, JPEG, GIF und WebP werden unterstützt. | Only PNG, JPEG, GIF and WebP are supported. |
| `image_size_error` | Bild zu groß (max. 5 MB). | Image too large (max. 5 MB). |
| `no_api_key_msg` | Bitte zuerst einen API-Key in den Einstellungen hinterlegen. | Please set an API key in settings first. |
| `import_json_error` | Ungültige Datei – kein valides JSON. | Invalid file – not valid JSON. |
| `import_format_error` | Ungültiges Format. | Invalid format. |
| `import_success` | %1 Unterhaltung%2 importiert. | %1 conversation%2 imported. |
| `import_plural_suffix` | en | s |

#### Date / relative time strings

| Key | German | English |
|-----|--------|---------|
| `date_today` | Heute | Today |
| `date_yesterday` | Gestern | Yesterday |
| `date_days_ago` | Vor %1 Tagen | %1 days ago |
| `date_weeks_ago` | Vor %1 Woche%2 | %1 week%2 ago |
| `date_months_ago` | Vor %1 Monat%2 | %1 month%2 ago |
| `date_week_plural` | n | s |
| `date_month_plural` | en | s |

#### API error strings

| Key | German | English |
|-----|--------|---------|
| `api_err_401` | API-Key ungültig oder nicht gesetzt. Bitte in den Einstellungen prüfen. | API key invalid or not set. Please check settings. |
| `api_err_403` | Kein Zugriff (%1). API-Key hat nicht die nötigen Rechte. | Access denied (%1). API key lacks required permissions. |
| `api_err_429` | Zu viele Anfragen – kurz warten und nochmal versuchen. | Too many requests – wait a moment and try again. |
| `api_err_5xx` | %1-Server vorübergehend nicht erreichbar. Später nochmal versuchen. | %1 server temporarily unavailable. Try again later. |
| `api_err_no_conn` | Keine Verbindung. Bitte Internetverbindung prüfen. | No connection. Please check your internet connection. |
| `api_err_generic` | %1 ist gerade nicht erreichbar (Fehlercode %2). | %1 is currently unreachable (error code %2). |
| `api_err_key_invalid` | API-Key ungültig | API key invalid |
| `api_err_status` | Fehler %1 | Error %1 |
| `api_err_no_models` | Keine Modelle gefunden | No models found |
| `api_err_load_fail` | Modelle konnten nicht geladen werden | Could not load models |
| `api_hint_enter_key` | API-Key eingeben um Modelle zu laden | Enter API key to load models |
| `api_hint_enter_url` | Base URL eingeben um Modelle zu laden | Enter Base URL to load models |
| `api_hint_not_found` | Base URL nicht gefunden | Base URL not found |
| `gemini_no_image` | Bildübertragung wird von Gemini in diesem Modus noch nicht unterstützt. | Image transfer is not yet supported for Gemini in this mode. |

#### Page context mode notice strings

| Key | German | English |
|-----|--------|---------|
| `ctx_mode_auto` | Seitenkontext: Auto | Page context: Auto |
| `ctx_mode_on` | Seitenkontext: Seite | Page context: Page |
| `ctx_mode_off` | Seitenkontext: Aus | Page context: Off |
| `ctx_web_search` | Websuche wird durchgeführt… | Running web search… |
| `ctx_page_opening` | 🔗 Seite wird geöffnet… | 🔗 Opening page… |
| `ctx_page_loading` | 🔗 Seite wird geladen… | 🔗 Loading page… |
| `ctx_subpage_opening` | 🔗 Unterseite wird geöffnet… | 🔗 Opening subpage… |
| `ctx_subpages_loading` | 🔗 Unterseiten werden geladen… | 🔗 Loading subpages… |
| `ctx_subpages_search` | 🔍 Relevante Unterseiten werden geladen… | 🔍 Loading relevant subpages… |
| `ctx_page_opened` | ✅ Seite geöffnet: %1 | ✅ Page opened: %1 |
| `ctx_subpages_loaded` | ✅ %1 Unterseite%2 geladen | ✅ %1 subpage%2 loaded |
| `ctx_subpage_plural` | n | s |

#### AI prompt strings (sent to the model)

| Key | German | English |
|-----|--------|---------|
| `sys_default_prompt` | Du bist ein hilfreicher KI-Assistent. | You are a helpful AI assistant. |
| `sys_quick_replies` | Wenn du dem Nutzer mehrere Optionen anbieten möchtest, kannst du am Ende deiner Antwort bis zu 4 klickbare Vorschläge mit folgendem Format hinzufügen: [QUICK_REPLIES: Option A \| Option B \| Option C] | If you want to offer the user multiple options, you can add up to 4 clickable suggestions at the end of your response in the following format: [QUICK_REPLIES: Option A \| Option B \| Option C] |
| `sys_date_prefix` | Aktuelles Datum: %1. | Current date: %1. |
| `sys_web_context` | Aktuelle Informationen aus dem Internet (via Websuche):\n<webcontext>\n%1\n</webcontext>\nNutze diese Informationen bevorzugt gegenüber deinem Trainingswissen. | Current information from the internet (via web search):\n<webcontext>\n%1\n</webcontext>\nPrefer this information over your training knowledge. |
| `sys_page_context` | Der Nutzer befindet sich auf: %1\nURL: %2\nSeiteninhalt:\n%3 | The user is on: %1\nURL: %2\nPage content:\n%3 |
| `sys_classify_yn` | Antworte ausschließlich mit 'ja' oder 'nein', ohne Erklärung. | Answer only with 'yes' or 'no', without explanation. |
| `sys_classify_page` | Bezieht sich diese Frage auf den Inhalt einer bestimmten Webseite, die der Nutzer gerade geöffnet hat? Frage: %1 | Does this question refer to the content of a specific webpage the user currently has open? Question: %1 |
| `sys_classify_subpage` | Bezieht sich diese Frage auf den Detailinhalt eines verlinkten Artikels oder einer Unterseite? Frage: %1 | Does this question refer to the detailed content of a linked article or subpage? Question: %1 |
| `sys_classify_uncertainty` | Signalisiert der folgende Text, dass das KI-Modell keine aktuellen oder zuverlässigen Informationen zu dem Thema hat (z.B. wegen Trainingsdaten-Cutoff, fehlendem Internetzugang, oder Wissenslücken zu aktuellen Ereignissen)? Text: %1 | Does the following text signal that the AI model lacks current or reliable information on the topic (e.g. due to training cutoff, no internet access, or knowledge gaps about recent events)? Text: %1 |
| `sys_classify_links` | Antworte ausschließlich mit einem JSON-Array von URLs, ohne Erklärung. Beispiel: ["https://example.com/news"] | Answer only with a JSON array of URLs, without explanation. Example: ["https://example.com/news"] |
| `sys_links_user` | Seite: %1\nURL: %2\n\nSeiteninhalt (Auszug):\n%3\n\nVerfügbare Links auf der Seite:\n%4\n\nNutzerfrage: %5\n\nWelche dieser Links (maximal 5) sind am relevantesten um die Frage zu beantworten? | Page: %1\nURL: %2\n\nPage content (excerpt):\n%3\n\nAvailable links on the page:\n%4\n\nUser question: %5\n\nWhich of these links (up to 5) are most relevant to answer the question? |

#### background.js agent strings

| Key | German | English |
|-----|--------|---------|
| `agent_analyzing` | Analysiere Seite… | Analyzing page… |
| `agent_aborted` | Abgebrochen. | Aborted. |
| `agent_screenshot_fail` | Screenshot fehlgeschlagen: %1 | Screenshot failed: %1 |
| `agent_dom_fail` | DOM-Extraktion fehlgeschlagen: %1 | DOM extraction failed: %1 |
| `agent_ai_fail` | AI-Aufruf fehlgeschlagen: %1 | AI call failed: %1 |
| `agent_no_response` | AI-Antwort konnte nicht gelesen werden. | Could not read AI response. |
| `agent_not_confirmed` | Aktion abgebrochen (nicht bestätigt). | Action cancelled (not confirmed). |
| `agent_done` | Erledigt: %1 | Done: %1 |
| `agent_done_default` | Aufgabe abgeschlossen | Task completed |
| `agent_action_error` | Fehler bei "%1": %2 | Error in "%1": %2 |
| `agent_action_unknown` | unbekannt | unknown |
| `agent_max_iter` | Maximale Iterationen (%1) erreicht. | Maximum iterations (%1) reached. |
| `agent_no_tab` | Kein aktiver Tab gefunden. | No active tab found. |
| `agent_start_fail` | Konnte Agent nicht starten. | Could not start agent. |
| `agent_error_prefix` | Fehler: %1 | Error: %1 |
| `agent_json_parse_error` | Ungültige AI-Antwort (JSON-Parse): %1 | Invalid AI response (JSON parse): %1 |
| `agent_click_log` | Klicke auf %1 | Click on %1 |
| `agent_type_log` | Tippe "%1" in %2 | Type "%1" into %2 |
| `agent_scroll_log` | Scrolle %1 | Scroll %1 |
| `agent_select_log` | Wähle "%1" in %2 | Select "%1" in %2 |
| `agent_navigate_log` | Navigiere zu %1 | Navigate to %1 |
| `agent_wait_log` | Warte %1ms… | Wait %1ms… |
| `agent_sys_prompt_de` | Du bist ein Web-Automatisierungs-Agent. Du erhältst einen Screenshot und eine Liste interaktiver Elemente der aktuellen Seite sowie eine Aufgabe.\nAntworte NUR mit einem JSON-Objekt (kein Markdown, kein Text drumherum) mit genau einem der folgenden Formate:\n- {"action":"click","selector":"<css-selektor>","reason":"<warum>"}\n- {"action":"type","selector":"<css-selektor>","value":"<text>","reason":"<warum>"}\n- {"action":"scroll","direction":"down"\|"up","amount":300,"reason":"<warum>"}\n- {"action":"select","selector":"<css-selektor>","value":"<option-value>","reason":"<warum>"}\n- {"action":"navigate","url":"<url>","reason":"<warum>"}\n- {"action":"wait","ms":1000,"reason":"<warum>"}\n- {"action":"done","summary":"<was wurde erreicht>"}\nVerwende nur Selektoren aus der DOM-Liste. Wenn du unsicher bist, wähle "scroll" oder "wait". | — |
| `agent_sys_prompt_en` | — | You are a web automation agent. You receive a screenshot and a list of interactive elements on the current page along with a task.\nReply ONLY with a JSON object (no markdown, no surrounding text) in exactly one of the following formats:\n- {"action":"click","selector":"<css-selector>","reason":"<why>"}\n- {"action":"type","selector":"<css-selector>","value":"<text>","reason":"<why>"}\n- {"action":"scroll","direction":"down"\|"up","amount":300,"reason":"<why>"}\n- {"action":"select","selector":"<css-selector>","value":"<option-value>","reason":"<why>"}\n- {"action":"navigate","url":"<url>","reason":"<why>"}\n- {"action":"wait","ms":1000,"reason":"<why>"}\n- {"action":"done","summary":"<what was achieved>"}\nOnly use selectors from the DOM list. When in doubt, choose "scroll" or "wait". |

The JSON schema format (field names, action names) is identical in both translations — only natural-language framing differs.

#### Context menu items (background.js)

| Key | German | English |
|-----|--------|---------|
| `menu_explain` | Mit AI erklären | Explain with AI |
| `menu_translate` | Mit AI übersetzen | Translate with AI |
| `menu_summarize` | Mit AI zusammenfassen | Summarize with AI |
| `prompt_explain` | Erkläre mir bitte Folgendes kurz und verständlich:\n\n"%1" | Please explain the following briefly and clearly:\n\n"%1" |
| `prompt_translate` | Übersetze den folgenden Text auf Deutsch:\n\n"%1" | Translate the following text to English:\n\n"%1" |
| `prompt_summarize` | Fasse den folgenden Text in 2-3 Sätzen zusammen:\n\n"%1" | Summarize the following text in 2-3 sentences:\n\n"%1" |

Note: `prompt_translate` target language switches — German UI translates to English, English UI translates to German. This is intentional: the user translates away from their current language.

---

## DOM Changes (popup.html)

- `<html lang="de">` → updated dynamically via JS to `"de"` or `"en"` after settings load
- All static text nodes replaced with `data-i18n` attributes on their parent elements
- `placeholder`, `title`, `aria-label` attributes replaced with `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-aria-label`
- New `<section class="settings-section">` added to settings panel, between Model and System Prompt sections:
  ```html
  <section class="settings-section">
    <label class="settings-label" for="language-select" data-i18n="language_label">Sprache / Language</label>
    <select id="language-select" class="settings-select">
      <option value="de">Deutsch</option>
      <option value="en">English</option>
    </select>
  </section>
  ```
  The label reads "Sprache / Language" in both languages — always legible.

---

## settings object changes

```js
const DEFAULT_SETTINGS = {
  provider: "hyperspace",
  apiKey: "",
  baseUrl: "http://localhost:6655/litellm/v1",
  model: "",
  customModel: "",
  systemPrompt: "",
  language: "de"   // new
};
```

`loadSettingsIntoUI()` sets `language-select` value.  
`saveSettingsFromUI()` reads `language-select`, calls `setLanguage(lang)` + `applyTranslations()` + sends `LANGUAGE_CHANGED` message to background.js.

---

## background.js language sync

MV3 background scripts can be killed and restarted at any time, so module state is not persistent. Background.js reads `settings.language` from storage at the start of each entry point that uses translated strings (`runAgentLoop`, `contextMenus.onClicked`), calling `setLanguage()` before using `t()`.

On receiving `LANGUAGE_CHANGED` message, it calls `setLanguage()` + re-registers context menu titles via `browser.contextMenus.update()` for each item so the right-click menu updates immediately.

---

## `applyTranslations()` execution points

1. `init()` — after settings loaded, before first render
2. `saveSettingsFromUI()` — after language setting saved
3. Not called on every message or re-render — translations are structural, not per-message

---

## Date locale

`buildSystemPrompt()` uses `toLocaleDateString("de-DE", ...)` — this switches to `"en-US"` when language is `"en"`.

---

## What is NOT translated

- Provider names: `Anthropic`, `OpenAI`, `Google Gemini`, `Hyperspace` (proper nouns)
- `Base URL` label (technical term, same in both languages)
- API key placeholders (`sk-…`, etc.)
- Model identifiers
- The agent JSON schema format instructions (machine-facing)
- `Auto` button label in page context control (same in both languages)

---

## Files changed

| File | Change |
|---|---|
| `i18n.js` | **New** — translations dictionary + `t()` + `applyTranslations()` |
| `popup.html` | Add `data-i18n*` attributes, add language `<select>` section |
| `popup.js` | Import i18n, replace all German strings with `t()`, wire language select |
| `background.js` | Import i18n, replace German strings with `t()`, handle `LANGUAGE_CHANGED` |

---

## Verification checklist (post-implementation)

- [ ] Switching to English in settings → all UI text updates instantly without reload
- [ ] Switching back to German → all UI text reverts
- [ ] Language persists across popup close/reopen
- [ ] Context menu items update language on next browser restart (or immediately via `contextMenus.update`)
- [ ] AI responses respect language (system prompt, classifier prompts translated)
- [ ] `formatRelativeDate()` strings (Today, Yesterday, X days ago) correct in both languages
- [ ] All `alert()` strings translated
- [ ] Error messages from `friendlyApiError()` translated
- [ ] Model fetch hints/errors translated
- [ ] Agent log entries translated
- [ ] No German strings remain hardcoded (grep check)
