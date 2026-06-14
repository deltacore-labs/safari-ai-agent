# i18n Language Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a German/English language picker to the settings panel that switches all UI text, AI prompts, and agent strings instantly at runtime without reloading the extension.

**Architecture:** A new `i18n.js` ES module holds all translations in a `TRANSLATIONS` object and exports a `t(key, ...args)` function and `applyTranslations()` DOM walker. Both `popup.js` and `background.js` import it. Language preference is stored in `settings.language` and applied on startup and whenever settings are saved.

**Tech Stack:** Vanilla JS ES modules, Safari WebExtension (MV3), `browser.storage.local`, `browser.contextMenus`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `Safari AI Agent Extension/Resources/i18n.js` | **Create** | All translations + `t()` + `applyTranslations()` |
| `Safari AI Agent Extension/Resources/popup.html` | Modify | Add `data-i18n*` attrs, add language `<select>` |
| `Safari AI Agent Extension/Resources/popup.js` | Modify | Import i18n, replace German strings, wire language select |
| `Safari AI Agent Extension/Resources/background.js` | Modify | Import i18n, replace German strings, handle `LANGUAGE_CHANGED` |

---

## Task 1: Create `i18n.js` — module skeleton + core API

**Files:**
- Create: `Safari AI Agent Extension/Resources/i18n.js`

- [ ] **Step 1: Create the file with module state and core functions**

```js
// i18n.js — translation module for popup.js and background.js
let currentLang = "de";

export function setLanguage(lang) {
  currentLang = lang === "en" ? "en" : "de";
}

export function getLanguage() {
  return currentLang;
}

export function t(key, ...args) {
  const dict = TRANSLATIONS[currentLang] ?? TRANSLATIONS.de;
  let str = dict[key] ?? TRANSLATIONS.de[key] ?? key;
  args.forEach((val, i) => {
    str = str.replace(`%${i + 1}`, val);
  });
  return str;
}

export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  });
}

const TRANSLATIONS = {
  de: {},
  en: {}
};
```

- [ ] **Step 2: Commit skeleton**

```bash
git add "Safari AI Agent Extension/Resources/i18n.js"
git commit -m "feat(i18n): add i18n module skeleton with t() and applyTranslations()"
```

---

## Task 2: Add all translations to `TRANSLATIONS` in `i18n.js`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/i18n.js`

- [ ] **Step 1: Replace the empty `TRANSLATIONS` object with the full dictionary**

Replace `const TRANSLATIONS = { de: {}, en: {} };` at the bottom of `i18n.js` with:

```js
const TRANSLATIONS = {
  de: {
    // Settings panel
    settings_title: "Einstellungen",
    provider_label: "KI-Anbieter",
    provider_local: "Lokal (Ollama / LM Studio)",
    base_url_label: "Base URL",
    api_key_label: "API-Key",
    api_key_toggle_aria: "API-Key anzeigen/verbergen",
    model_label: "Modell",
    model_loading: "Modelle werden geladen…",
    model_reload_aria: "Modelle neu laden",
    system_prompt_label: "System Prompt",
    system_prompt_optional: "(optional)",
    system_prompt_placeholder: "Du bist ein hilfreicher KI-Assistent…",
    language_label: "Sprache / Language",
    data_label: "Daten",
    export_btn: "Exportieren",
    import_btn: "Importieren",
    clear_history_btn: "Verlauf löschen",
    save_settings_btn: "Einstellungen speichern",
    saved_confirm: "Gespeichert ✓",
    claude_config_badge: "Aus Claude Code konfiguriert",
    // Chat header
    page_ctx_auto_title: "Automatisch erkennen",
    page_ctx_on_title: "Seite immer einbeziehen",
    page_ctx_off_title: "Seite nie einbeziehen",
    page_ctx_btn_on: "Seite",
    page_ctx_btn_off: "Aus",
    history_aria: "Gesprächsverlauf",
    history_search_placeholder: "Suchen…",
    new_conversation_btn: "Neue Unterhaltung",
    new_chat_aria: "Neue Konversation",
    attach_aria: "Bild anhängen",
    input_placeholder: "Frage stellen…",
    input_aria: "Nachricht eingeben",
    send_aria: "Senden",
    stop_aria: "Abbrechen",
    darkmode_aria: "Dark Mode umschalten",
    back_aria: "Zurück",
    image_preview_alt: "Anhang Vorschau",
    image_remove_aria: "Bild entfernen",
    empty_state_text: "Stelle mir eine Frage zu dieser Seite oder irgendeinem anderen Thema.",
    // History / conversations
    pin_btn_unpin: "Lösen",
    pin_btn_pin: "Anpinnen",
    copy_btn_title: "Kopieren",
    copy_btn_done: "✓",
    code_copy_btn: "Kopieren",
    no_model_selected: "Kein Modell ausgewählt",
    conv_title_fallback: "Unterhaltung",
    new_conv_title: "Neue Unterhaltung",
    imported_conv_title: "Importierte Unterhaltung",
    // Agent section
    agent_section_label: "Agent",
    agent_placeholder: "Aufgabe beschreiben, z.B. „Melde mich mit user@example.com an"",
    agent_start_btn: "Starten",
    agent_stop_btn: "Stop",
    agent_confirm_btn_yes: "Ausführen",
    agent_confirm_btn_no: "Abbrechen",
    confirm_prefix: "Bestätigen: %1",
    retry_btn: "↻ Nochmal versuchen",
    // Alerts / errors (popup)
    image_type_error: "Nur PNG, JPEG, GIF und WebP werden unterstützt.",
    image_size_error: "Bild zu groß (max. 5 MB).",
    no_api_key_msg: "Bitte zuerst einen API-Key in den Einstellungen hinterlegen.",
    import_json_error: "Ungültige Datei – kein valides JSON.",
    import_format_error: "Ungültiges Format.",
    import_success: "%1 Unterhaltung%2 importiert.",
    import_plural_suffix: "en",
    // Relative dates
    date_today: "Heute",
    date_yesterday: "Gestern",
    date_days_ago: "Vor %1 Tagen",
    date_weeks_ago: "Vor %1 Woche%2",
    date_months_ago: "Vor %1 Monat%2",
    date_week_plural: "n",
    date_month_plural: "en",
    // API errors
    api_err_401: "API-Key ungültig oder nicht gesetzt. Bitte in den Einstellungen prüfen.",
    api_err_403: "Kein Zugriff (%1). API-Key hat nicht die nötigen Rechte.",
    api_err_429: "Zu viele Anfragen – kurz warten und nochmal versuchen.",
    api_err_5xx: "%1-Server vorübergehend nicht erreichbar. Später nochmal versuchen.",
    api_err_no_conn: "Keine Verbindung. Bitte Internetverbindung prüfen.",
    api_err_generic: "%1 ist gerade nicht erreichbar (Fehlercode %2).",
    api_err_key_invalid: "API-Key ungültig",
    api_err_status: "Fehler %1",
    api_err_no_models: "Keine Modelle gefunden",
    api_err_load_fail: "Modelle konnten nicht geladen werden",
    api_hint_enter_key: "API-Key eingeben um Modelle zu laden",
    api_hint_enter_url: "Base URL eingeben um Modelle zu laden",
    api_hint_not_found: "Base URL nicht gefunden",
    gemini_no_image: "Bildübertragung wird von Gemini in diesem Modus noch nicht unterstützt.",
    // Page context notices
    ctx_mode_auto: "Seitenkontext: Auto",
    ctx_mode_on: "Seitenkontext: Seite",
    ctx_mode_off: "Seitenkontext: Aus",
    ctx_web_search: "Websuche wird durchgeführt…",
    ctx_page_opening: "🔗 Seite wird geöffnet…",
    ctx_page_loading: "🔗 Seite wird geladen…",
    ctx_subpage_opening: "🔗 Unterseite wird geöffnet…",
    ctx_subpages_loading: "🔗 Unterseiten werden geladen…",
    ctx_subpages_search: "🔍 Relevante Unterseiten werden geladen…",
    ctx_page_opened: "✅ Seite geöffnet: %1",
    ctx_subpages_loaded: "✅ %1 Unterseite%2 geladen",
    ctx_subpage_plural: "n",
    // AI system prompts
    sys_default_prompt: "Du bist ein hilfreicher KI-Assistent.",
    sys_quick_replies: "Wenn du dem Nutzer mehrere Optionen anbieten möchtest, kannst du am Ende deiner Antwort bis zu 4 klickbare Vorschläge mit folgendem Format hinzufügen: [QUICK_REPLIES: Option A | Option B | Option C]",
    sys_date_prefix: "Aktuelles Datum: %1.",
    sys_web_context: "Aktuelle Informationen aus dem Internet (via Websuche):\n<webcontext>\n%1\n</webcontext>\nNutze diese Informationen bevorzugt gegenüber deinem Trainingswissen.",
    sys_page_context: "Der Nutzer befindet sich auf: %1\nURL: %2\nSeiteninhalt:\n%3",
    sys_classify_yn: "Antworte ausschließlich mit 'ja' oder 'nein', ohne Erklärung.",
    sys_classify_yn_answer: "ja",
    sys_classify_page: "Bezieht sich diese Frage auf den Inhalt einer bestimmten Webseite, die der Nutzer gerade geöffnet hat? Frage: %1",
    sys_classify_subpage: "Bezieht sich diese Frage auf den Detailinhalt eines verlinkten Artikels oder einer Unterseite? Frage: %1",
    sys_classify_uncertainty: "Signalisiert der folgende Text, dass das KI-Modell keine aktuellen oder zuverlässigen Informationen zu dem Thema hat (z.B. wegen Trainingsdaten-Cutoff, fehlendem Internetzugang, oder Wissenslücken zu aktuellen Ereignissen)? Text: %1",
    sys_classify_links: "Antworte ausschließlich mit einem JSON-Array von URLs, ohne Erklärung. Beispiel: [\"https://example.com/news\"]",
    sys_links_user: "Seite: %1\nURL: %2\n\nSeiteninhalt (Auszug):\n%3\n\nVerfügbare Links auf der Seite:\n%4\n\nNutzerfrage: %5\n\nWelche dieser Links (maximal 5) sind am relevantesten um die Frage zu beantworten?",
    // background.js agent
    agent_analyzing: "Analysiere Seite…",
    agent_aborted: "Abgebrochen.",
    agent_screenshot_fail: "Screenshot fehlgeschlagen: %1",
    agent_dom_fail: "DOM-Extraktion fehlgeschlagen: %1",
    agent_ai_fail: "AI-Aufruf fehlgeschlagen: %1",
    agent_no_response: "AI-Antwort konnte nicht gelesen werden.",
    agent_not_confirmed: "Aktion abgebrochen (nicht bestätigt).",
    agent_done: "Erledigt: %1",
    agent_done_default: "Aufgabe abgeschlossen",
    agent_action_error: "Fehler bei \"%1\": %2",
    agent_action_unknown: "unbekannt",
    agent_max_iter: "Maximale Iterationen (%1) erreicht.",
    agent_no_tab: "Kein aktiver Tab gefunden.",
    agent_start_fail: "Konnte Agent nicht starten.",
    agent_error_prefix: "Fehler: %1",
    agent_json_parse_error: "Ungültige AI-Antwort (JSON-Parse): %1",
    agent_click_log: "Klicke auf %1",
    agent_type_log: "Tippe \"%1\" in %2",
    agent_scroll_log: "Scrolle %1",
    agent_select_log: "Wähle \"%1\" in %2",
    agent_navigate_log: "Navigiere zu %1",
    agent_wait_log: "Warte %1ms…",
    agent_sys_prompt: "Du bist ein Web-Automatisierungs-Agent. Du erhältst einen Screenshot und eine Liste interaktiver Elemente der aktuellen Seite sowie eine Aufgabe.\nAntworte NUR mit einem JSON-Objekt (kein Markdown, kein Text drumherum) mit genau einem der folgenden Formate:\n- {\"action\":\"click\",\"selector\":\"<css-selektor>\",\"reason\":\"<warum>\"}\n- {\"action\":\"type\",\"selector\":\"<css-selektor>\",\"value\":\"<text>\",\"reason\":\"<warum>\"}\n- {\"action\":\"scroll\",\"direction\":\"down\"|\"up\",\"amount\":300,\"reason\":\"<warum>\"}\n- {\"action\":\"select\",\"selector\":\"<css-selektor>\",\"value\":\"<option-value>\",\"reason\":\"<warum>\"}\n- {\"action\":\"navigate\",\"url\":\"<url>\",\"reason\":\"<warum>\"}\n- {\"action\":\"wait\",\"ms\":1000,\"reason\":\"<warum>\"}\n- {\"action\":\"done\",\"summary\":\"<was wurde erreicht>\"}\nVerwende nur Selektoren aus der DOM-Liste. Wenn du unsicher bist, wähle \"scroll\" oder \"wait\".",
    agent_task_label: "Aufgabe: %1\nIteration: %2/%3\nURL: %4\n\nInteraktive Elemente:\n%5",
    agent_no_elements: "(keine gefunden)",
    // Context menus
    menu_explain: "Mit AI erklären",
    menu_translate: "Mit AI übersetzen",
    menu_summarize: "Mit AI zusammenfassen",
    prompt_explain: "Erkläre mir bitte Folgendes kurz und verständlich:\n\n\"%1\"",
    prompt_translate: "Übersetze den folgenden Text auf Deutsch:\n\n\"%1\"",
    prompt_summarize: "Fasse den folgenden Text in 2-3 Sätzen zusammen:\n\n\"%1\"",
  },
  en: {
    // Settings panel
    settings_title: "Settings",
    provider_label: "AI Provider",
    provider_local: "Local (Ollama / LM Studio)",
    base_url_label: "Base URL",
    api_key_label: "API Key",
    api_key_toggle_aria: "Show/hide API key",
    model_label: "Model",
    model_loading: "Loading models…",
    model_reload_aria: "Reload models",
    system_prompt_label: "System Prompt",
    system_prompt_optional: "(optional)",
    system_prompt_placeholder: "You are a helpful AI assistant…",
    language_label: "Sprache / Language",
    data_label: "Data",
    export_btn: "Export",
    import_btn: "Import",
    clear_history_btn: "Clear history",
    save_settings_btn: "Save settings",
    saved_confirm: "Saved ✓",
    claude_config_badge: "Configured from Claude Code",
    // Chat header
    page_ctx_auto_title: "Auto-detect",
    page_ctx_on_title: "Always include page",
    page_ctx_off_title: "Never include page",
    page_ctx_btn_on: "Page",
    page_ctx_btn_off: "Off",
    history_aria: "Conversation history",
    history_search_placeholder: "Search…",
    new_conversation_btn: "New conversation",
    new_chat_aria: "New conversation",
    attach_aria: "Attach image",
    input_placeholder: "Ask a question…",
    input_aria: "Enter message",
    send_aria: "Send",
    stop_aria: "Stop",
    darkmode_aria: "Toggle dark mode",
    back_aria: "Back",
    image_preview_alt: "Attachment preview",
    image_remove_aria: "Remove image",
    empty_state_text: "Ask me anything about this page or any other topic.",
    // History / conversations
    pin_btn_unpin: "Unpin",
    pin_btn_pin: "Pin",
    copy_btn_title: "Copy",
    copy_btn_done: "✓",
    code_copy_btn: "Copy",
    no_model_selected: "No model selected",
    conv_title_fallback: "Conversation",
    new_conv_title: "New conversation",
    imported_conv_title: "Imported conversation",
    // Agent section
    agent_section_label: "Agent",
    agent_placeholder: "Describe task, e.g. \"Log me in with user@example.com\"",
    agent_start_btn: "Start",
    agent_stop_btn: "Stop",
    agent_confirm_btn_yes: "Execute",
    agent_confirm_btn_no: "Cancel",
    confirm_prefix: "Confirm: %1",
    retry_btn: "↻ Try again",
    // Alerts / errors (popup)
    image_type_error: "Only PNG, JPEG, GIF and WebP are supported.",
    image_size_error: "Image too large (max. 5 MB).",
    no_api_key_msg: "Please set an API key in settings first.",
    import_json_error: "Invalid file – not valid JSON.",
    import_format_error: "Invalid format.",
    import_success: "%1 conversation%2 imported.",
    import_plural_suffix: "s",
    // Relative dates
    date_today: "Today",
    date_yesterday: "Yesterday",
    date_days_ago: "%1 days ago",
    date_weeks_ago: "%1 week%2 ago",
    date_months_ago: "%1 month%2 ago",
    date_week_plural: "s",
    date_month_plural: "s",
    // API errors
    api_err_401: "API key invalid or not set. Please check settings.",
    api_err_403: "Access denied (%1). API key lacks required permissions.",
    api_err_429: "Too many requests – wait a moment and try again.",
    api_err_5xx: "%1 server temporarily unavailable. Try again later.",
    api_err_no_conn: "No connection. Please check your internet connection.",
    api_err_generic: "%1 is currently unreachable (error code %2).",
    api_err_key_invalid: "API key invalid",
    api_err_status: "Error %1",
    api_err_no_models: "No models found",
    api_err_load_fail: "Could not load models",
    api_hint_enter_key: "Enter API key to load models",
    api_hint_enter_url: "Enter Base URL to load models",
    api_hint_not_found: "Base URL not found",
    gemini_no_image: "Image transfer is not yet supported for Gemini in this mode.",
    // Page context notices
    ctx_mode_auto: "Page context: Auto",
    ctx_mode_on: "Page context: Page",
    ctx_mode_off: "Page context: Off",
    ctx_web_search: "Running web search…",
    ctx_page_opening: "🔗 Opening page…",
    ctx_page_loading: "🔗 Loading page…",
    ctx_subpage_opening: "🔗 Opening subpage…",
    ctx_subpages_loading: "🔗 Loading subpages…",
    ctx_subpages_search: "🔍 Loading relevant subpages…",
    ctx_page_opened: "✅ Page opened: %1",
    ctx_subpages_loaded: "✅ %1 subpage%2 loaded",
    ctx_subpage_plural: "s",
    // AI system prompts
    sys_default_prompt: "You are a helpful AI assistant.",
    sys_quick_replies: "If you want to offer the user multiple options, you can add up to 4 clickable suggestions at the end of your response in the following format: [QUICK_REPLIES: Option A | Option B | Option C]",
    sys_date_prefix: "Current date: %1.",
    sys_web_context: "Current information from the internet (via web search):\n<webcontext>\n%1\n</webcontext>\nPrefer this information over your training knowledge.",
    sys_page_context: "The user is on: %1\nURL: %2\nPage content:\n%3",
    sys_classify_yn: "Answer only with 'yes' or 'no', without explanation.",
    sys_classify_yn_answer: "yes",
    sys_classify_page: "Does this question refer to the content of a specific webpage the user currently has open? Question: %1",
    sys_classify_subpage: "Does this question refer to the detailed content of a linked article or subpage? Question: %1",
    sys_classify_uncertainty: "Does the following text signal that the AI model lacks current or reliable information on the topic (e.g. due to training cutoff, no internet access, or knowledge gaps about recent events)? Text: %1",
    sys_classify_links: "Answer only with a JSON array of URLs, without explanation. Example: [\"https://example.com/news\"]",
    sys_links_user: "Page: %1\nURL: %2\n\nPage content (excerpt):\n%3\n\nAvailable links on the page:\n%4\n\nUser question: %5\n\nWhich of these links (up to 5) are most relevant to answer the question?",
    // background.js agent
    agent_analyzing: "Analyzing page…",
    agent_aborted: "Aborted.",
    agent_screenshot_fail: "Screenshot failed: %1",
    agent_dom_fail: "DOM extraction failed: %1",
    agent_ai_fail: "AI call failed: %1",
    agent_no_response: "Could not read AI response.",
    agent_not_confirmed: "Action cancelled (not confirmed).",
    agent_done: "Done: %1",
    agent_done_default: "Task completed",
    agent_action_error: "Error in \"%1\": %2",
    agent_action_unknown: "unknown",
    agent_max_iter: "Maximum iterations (%1) reached.",
    agent_no_tab: "No active tab found.",
    agent_start_fail: "Could not start agent.",
    agent_error_prefix: "Error: %1",
    agent_json_parse_error: "Invalid AI response (JSON parse): %1",
    agent_click_log: "Click on %1",
    agent_type_log: "Type \"%1\" into %2",
    agent_scroll_log: "Scroll %1",
    agent_select_log: "Select \"%1\" in %2",
    agent_navigate_log: "Navigate to %1",
    agent_wait_log: "Wait %1ms…",
    agent_sys_prompt: "You are a web automation agent. You receive a screenshot and a list of interactive elements on the current page along with a task.\nReply ONLY with a JSON object (no markdown, no surrounding text) in exactly one of the following formats:\n- {\"action\":\"click\",\"selector\":\"<css-selector>\",\"reason\":\"<why>\"}\n- {\"action\":\"type\",\"selector\":\"<css-selector>\",\"value\":\"<text>\",\"reason\":\"<why>\"}\n- {\"action\":\"scroll\",\"direction\":\"down\"|\"up\",\"amount\":300,\"reason\":\"<why>\"}\n- {\"action\":\"select\",\"selector\":\"<css-selector>\",\"value\":\"<option-value>\",\"reason\":\"<why>\"}\n- {\"action\":\"navigate\",\"url\":\"<url>\",\"reason\":\"<why>\"}\n- {\"action\":\"wait\",\"ms\":1000,\"reason\":\"<why>\"}\n- {\"action\":\"done\",\"summary\":\"<what was achieved>\"}\nOnly use selectors from the DOM list. When in doubt, choose \"scroll\" or \"wait\".",
    agent_task_label: "Task: %1\nIteration: %2/%3\nURL: %4\n\nInteractive elements:\n%5",
    agent_no_elements: "(none found)",
    // Context menus
    menu_explain: "Explain with AI",
    menu_translate: "Translate with AI",
    menu_summarize: "Summarize with AI",
    prompt_explain: "Please explain the following briefly and clearly:\n\n\"%1\"",
    prompt_translate: "Translate the following text to English:\n\n\"%1\"",
    prompt_summarize: "Summarize the following text in 2-3 sentences:\n\n\"%1\"",
  }
};
```

- [ ] **Step 2: Commit translations**

```bash
git add "Safari AI Agent Extension/Resources/i18n.js"
git commit -m "feat(i18n): add full DE/EN translation dictionary"
```

---

## Task 3: Add `data-i18n*` attributes and language `<select>` to `popup.html`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.html`

- [ ] **Step 1: Change `<html lang="de">` to `<html lang="de" id="html-root">`**

This lets `applyTranslations()` update the lang attribute via JS. In `popup.js` (Task 4), add `document.documentElement.lang = getLanguage()` inside `applyTranslations()`.

- [ ] **Step 2: Add `data-i18n-aria-label` to header buttons and controls**

Replace the `aria-label` / `title` attributes on these elements with `data-i18n-*` equivalents (keep the current German text as fallback content, the JS will overwrite on load):

```html
<!-- page context buttons -->
<button data-mode="auto"  class="page-ctx-btn active" aria-pressed="true"
  data-i18n-title="page_ctx_auto_title" title="Automatisch erkennen">Auto</button>
<button data-mode="on"    class="page-ctx-btn"         aria-pressed="false"
  data-i18n-title="page_ctx_on_title" title="Seite immer einbeziehen"
  data-i18n="page_ctx_btn_on">Seite</button>
<button data-mode="off"   class="page-ctx-btn"         aria-pressed="false"
  data-i18n-title="page_ctx_off_title" title="Seite nie einbeziehen"
  data-i18n="page_ctx_btn_off">Aus</button>

<!-- icon buttons -->
<button id="history-btn" class="icon-btn"
  data-i18n-aria-label="history_aria" aria-label="Gesprächsverlauf"
  data-i18n-title="history_aria" title="Gesprächsverlauf">…</button>

<button id="new-chat-btn" class="icon-btn"
  data-i18n-aria-label="new_chat_aria" aria-label="Neue Konversation"
  data-i18n-title="new_chat_aria" title="Neue Konversation">…</button>

<button id="darkmode-btn" class="icon-btn"
  data-i18n-aria-label="darkmode_aria" aria-label="Dark Mode umschalten"
  data-i18n-title="darkmode_aria" title="Dark Mode">…</button>

<button id="back-btn" class="icon-btn"
  data-i18n-aria-label="back_aria" aria-label="Zurück">…</button>
```

- [ ] **Step 3: Add `data-i18n` to the history dropdown**

```html
<div id="history-dropdown" class="history-dropdown hidden" role="listbox"
  data-i18n-aria-label="history_aria" aria-label="Gesprächsverlauf">
  <div class="history-search-wrap">
    <input type="search" id="history-search" class="history-search-input"
      data-i18n-placeholder="history_search_placeholder"
      placeholder="Suchen…" autocomplete="off" spellcheck="false">
  </div>
  <button id="new-conv-btn" class="history-new-btn" role="option"
    data-i18n="new_conversation_btn">Neue Unterhaltung</button>
```

- [ ] **Step 4: Add `data-i18n` to the empty state, input area, and image preview**

```html
<!-- empty state -->
<p data-i18n="empty_state_text">Stelle mir eine Frage zu dieser Seite oder irgendeinem anderen Thema.</p>

<!-- attach button -->
<button id="attach-btn" class="icon-btn attach-btn"
  data-i18n-aria-label="attach_aria" aria-label="Bild anhängen"
  data-i18n-title="attach_aria" title="Bild anhängen">…</button>

<!-- textarea -->
<textarea id="user-input"
  data-i18n-placeholder="input_placeholder" placeholder="Frage stellen…"
  data-i18n-aria-label="input_aria" aria-label="Nachricht eingeben"
  rows="1" maxlength="4000"></textarea>

<!-- send button -->
<button id="send-btn" class="send-btn"
  data-i18n-aria-label="send_aria" aria-label="Senden" disabled>…</button>

<!-- image preview -->
<img id="image-preview" class="image-preview-thumb" src=""
  data-i18n-alt="image_preview_alt" alt="Anhang Vorschau">
<button id="image-remove-btn" class="image-remove-btn"
  data-i18n-aria-label="image_remove_aria" aria-label="Bild entfernen">×</button>
```

Note: `alt` attribute is not handled by the standard `applyTranslations()` — add support for `data-i18n-alt` in Task 4 alongside the other attribute types.

- [ ] **Step 5: Add `data-i18n` to the agent section**

```html
<button id="agent-toggle" class="agent-toggle" aria-expanded="false" aria-controls="agent-section-body">
  <span data-i18n="agent_section_label">Agent</span>
  …
</button>
<textarea id="agent-task-input" class="agent-task-input"
  data-i18n-placeholder="agent_placeholder"
  placeholder='Aufgabe beschreiben, z.B. „Melde mich mit user@example.com an"'
  rows="2"></textarea>
<button id="agent-start-btn" class="agent-start-btn" data-i18n="agent_start_btn">Starten</button>
<button id="agent-stop-btn"  class="agent-stop-btn hidden" data-i18n="agent_stop_btn">Stop</button>
<button id="agent-confirm-yes" class="agent-confirm-btn agent-confirm-yes" data-i18n="agent_confirm_btn_yes">Ausführen</button>
<button id="agent-confirm-no"  class="agent-confirm-btn agent-confirm-no"  data-i18n="agent_confirm_btn_no">Abbrechen</button>
```

- [ ] **Step 6: Add `data-i18n` to settings panel labels and buttons**

```html
<span class="header-title" data-i18n="settings_title">Einstellungen</span>

<label class="settings-label" for="provider-select" data-i18n="provider_label">KI-Anbieter</label>

<!-- Local option in provider select -->
<option value="local" data-i18n="provider_local">Lokal (Ollama / LM Studio)</option>

<label class="settings-label" for="base-url-input" data-i18n="base_url_label">Base URL</label>

<label class="settings-label" for="api-key-input" data-i18n="api_key_label">API-Key</label>
<button class="visibility-btn" id="toggle-key-btn"
  data-i18n-aria-label="api_key_toggle_aria" aria-label="API-Key anzeigen/verbergen" type="button">…</button>

<label class="settings-label" for="model-select" data-i18n="model_label">Modell</label>
<button id="refresh-models-btn" class="icon-btn icon-btn--xs"
  data-i18n-aria-label="model_reload_aria" aria-label="Modelle neu laden"
  data-i18n-title="model_reload_aria" title="Modelle neu laden">…</button>

<label class="settings-label" for="system-prompt-input" data-i18n="system_prompt_label">System Prompt</label>
<span class="label-optional" data-i18n="system_prompt_optional">(optional)</span>
<textarea id="system-prompt-input" class="settings-textarea" rows="3"
  data-i18n-placeholder="system_prompt_placeholder"
  placeholder="Du bist ein hilfreicher KI-Assistent…"></textarea>

<label class="settings-label" data-i18n="data_label">Daten</label>
<button id="export-btn" class="btn-secondary" data-i18n="export_btn">Exportieren</button>
<button id="import-btn" class="btn-secondary" data-i18n="import_btn">Importieren</button>
<button id="clear-history-btn" class="btn-secondary btn--full" data-i18n="clear_history_btn">Verlauf löschen</button>
<button id="save-settings-btn" class="btn-fin btn--full" data-i18n="save_settings_btn">Einstellungen speichern</button>

<!-- Claude config badge -->
<span data-i18n="claude_config_badge">Aus Claude Code konfiguriert</span>
```

- [ ] **Step 7: Add the language picker section** (insert between the Model section and the System Prompt section in the settings panel)

```html
<section class="settings-section">
  <label class="settings-label" for="language-select">Sprache / Language</label>
  <select id="language-select" class="settings-select">
    <option value="de">Deutsch</option>
    <option value="en">English</option>
  </select>
</section>
```

- [ ] **Step 8: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.html"
git commit -m "feat(i18n): add data-i18n attributes and language select to popup.html"
```

---

## Task 4: Wire i18n into `popup.js`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/popup.js`

- [ ] **Step 1: Add import at the top of `popup.js`** (after the existing `// ── Provider Configuration` comment block, before `const PROVIDERS`)

```js
import { t, setLanguage, getLanguage, applyTranslations as _applyTranslations } from "./i18n.js";

function applyTranslations() {
  _applyTranslations(document);
  // Also handle data-i18n-alt
  document.querySelectorAll("[data-i18n-alt]").forEach(el => {
    el.alt = t(el.dataset.i18nAlt);
  });
  // Update html lang attribute
  document.documentElement.lang = getLanguage();
}
```

- [ ] **Step 2: Add `language` to `DEFAULT_SETTINGS`**

```js
const DEFAULT_SETTINGS = {
  provider: "hyperspace",
  apiKey: "",
  baseUrl: "http://localhost:6655/litellm/v1",
  model: "",
  customModel: "",
  systemPrompt: "",
  language: "de"
};
```

- [ ] **Step 3: Replace `formatRelativeDate` to use `t()`**

Replace the entire `formatRelativeDate` function:

```js
function formatRelativeDate(timestamp) {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t("date_today");
  if (diffDays === 1) return t("date_yesterday");
  if (diffDays < 7) return t("date_days_ago", diffDays);
  const weeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return t("date_weeks_ago", weeks, weeks > 1 ? t("date_week_plural") : "");
  const months = Math.floor(diffDays / 30);
  return t("date_months_ago", months, months > 1 ? t("date_month_plural") : "");
}
```

- [ ] **Step 4: Replace hardcoded strings in `renderHistoryDropdown`**

```js
// Line: titleEl.textContent = conv.title || "Unterhaltung";
titleEl.textContent = conv.title || t("conv_title_fallback");

// Line: pinBtn.title = conv.pinned ? "Lösen" : "Anpinnen";
pinBtn.title = conv.pinned ? t("pin_btn_unpin") : t("pin_btn_pin");
```

- [ ] **Step 5: Replace hardcoded strings in `populateModelDropdown`**

```js
// Line: modelSelect.innerHTML = `<option value="">Modelle werden geladen…</option>`;
modelSelect.innerHTML = `<option value="">${t("model_loading")}</option>`;
```

- [ ] **Step 6: Replace hardcoded strings in `fetchModelsForProvider`**

```js
// "API-Key eingeben um Modelle zu laden"
return { hint: t("api_hint_enter_key") };

// "API-Key ungültig" (appears 2×)
return { error: t("api_err_key_invalid") };

// "Fehler ${res.status}" (appears 2×)
return { error: t("api_err_status", res.status) };

// "Keine Modelle gefunden" (appears 2×)
return models.length ? models : { error: t("api_err_no_models") };

// "Base URL eingeben um Modelle zu laden"
return { hint: t("api_hint_enter_url") };

// "Base URL nicht gefunden"
return { error: t("api_hint_not_found") };

// "Modelle konnten nicht geladen werden"
return { error: t("api_err_load_fail") };
```

- [ ] **Step 7: Replace hardcoded strings in `saveSettingsFromUI`**

```js
// Line: btn.textContent = "Gespeichert ✓";
btn.textContent = t("saved_confirm");
// Line: setTimeout(() => { btn.textContent = original; }, 1500);
// (original is already the translated string from the DOM — no change needed)
```

- [ ] **Step 8: Replace strings in `loadImageFile`**

```js
// Line: alert("Nur PNG, JPEG, GIF und WebP werden unterstützt.");
alert(t("image_type_error"));

// Line: alert("Bild zu groß (max. 5 MB).");
alert(t("image_size_error"));
```

- [ ] **Step 9: Replace strings in `renderModelTag`**

```js
// Line: tag.textContent = modelName || "Kein Modell ausgewählt";
tag.textContent = modelName || t("no_model_selected");
```

- [ ] **Step 10: Replace strings in `renderEmptyState`**

```js
// Line: <p>Stelle mir eine Frage…</p>
// The HTML is rebuilt from a template literal — update it:
messages.innerHTML = `
  <div id="empty-state" class="empty-state">
    <svg …/>
    <p>${t("empty_state_text")}</p>
  </div>`;
```

- [ ] **Step 11: Replace strings in `renderMessage`**

```js
// Line: copyBtn.title = "Kopieren";
copyBtn.title = t("copy_btn_title");

// In the click handler, replace "✓" and the restore:
copyBtn.innerHTML = `<svg …/>`;  // stays the same — it's an icon, not text
// But the code-copy button text in highlightCode:
btn.textContent = t("code_copy_btn");
// restore:
setTimeout(() => { btn.textContent = t("code_copy_btn"); }, 1500);
```

- [ ] **Step 12: Replace strings in `friendlyApiError`**

```js
function friendlyApiError(provider, status, body) {
  if (status === 401) return t("api_err_401");
  if (status === 403) return t("api_err_403", provider);
  if (status === 429) return t("api_err_429");
  if (status === 500 || status === 503) return t("api_err_5xx", provider);
  if (status === 0 || !status) return t("api_err_no_conn");
  try {
    const json = JSON.parse(body);
    const msg = json?.error?.message ?? json?.message;
    if (msg) return msg;
  } catch { /* fall through */ }
  return t("api_err_generic", provider, status);
}
```

- [ ] **Step 13: Replace strings in `buildSystemPrompt`**

```js
function buildSystemPrompt(includePageContext = false, webContext = null) {
  const base = settings.systemPrompt?.trim() || t("sys_default_prompt");
  const quickRepliesInstruction = t("sys_quick_replies");
  const now = new Date();
  const locale = getLanguage() === "en" ? "en-US" : "de-DE";
  const dateStr = now.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let prompt = `${base}\n\n${quickRepliesInstruction}\n\n${t("sys_date_prefix", dateStr)}`;

  if (webContext) {
    prompt += `\n\n${t("sys_web_context", webContext)}`;
  }

  if (!includePageContext || !currentPageContext || currentPageContext._debugError) return prompt;

  return [
    prompt,
    "",
    t("sys_page_context", currentPageContext.title, currentPageContext.url, currentPageContext.text)
  ].join("\n");
}
```

- [ ] **Step 14: Replace classifier / AI prompt strings**

In `classifySubpageNeed`, `classifyWithAI`, `uncertaintyCheck`, `selectRelevantLinks` — replace the hardcoded `systemMsg` / `userMsg` strings:

```js
// classifySubpageNeed and classifyWithAI:
const systemMsg = t("sys_classify_yn");
// classifySubpageNeed:
const userMsg = t("sys_classify_subpage", text);
// classifyWithAI:
const userMsg = t("sys_classify_page", text);
// uncertaintyCheck:
const systemMsg = t("sys_classify_yn");
const userMsg = t("sys_classify_uncertainty", text);
// selectRelevantLinks:
const systemMsg = t("sys_classify_links");
const userMsg = t("sys_links_user", rootContent.title, rootContent.url, rootContent.text.slice(0, 3000), linkList, question);
```

Also update the `answer.includes("ja")` checks in all four functions — they must also check the English word:

```js
// Replace: return answer.includes("ja") || answer.includes("yes");
// With (works for both locales since the model may respond in either):
return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
```

- [ ] **Step 15: Replace context mode notice strings**

```js
// In runWebSearchFallback:
renderContextModeNotice(t("ctx_web_search"));

// In sendMessage – URL fetch:
renderContextModeNotice(showPage ? t("ctx_page_opening") : t("ctx_page_loading"));
renderContextModeNotice("🔍 " + t("ctx_subpages_search").replace("🔍 ", ""));
// simpler — just use the key directly:
renderContextModeNotice(t("ctx_subpages_search"));

// Subpage result notices:
renderContextModeNotice(showPage && selectedUrls.length === 1
  ? t("ctx_page_opened", subpages[0].title)
  : t("ctx_subpages_loaded", subpages.length, subpages.length > 1 ? t("ctx_subpage_plural") : ""));

// Subpage opening notice:
renderContextModeNotice(showPage ? t("ctx_subpage_opening") : t("ctx_subpages_loading"));
```

- [ ] **Step 16: Replace page context mode label map**

```js
// In the page-ctx-control click handler:
const MODE_LABELS = {
  auto: t("ctx_mode_auto"),
  on:   t("ctx_mode_on"),
  off:  t("ctx_mode_off")
};
```

- [ ] **Step 17: Replace remaining strings**

```js
// sendMessage — no API key guard:
renderMessage("ai", t("no_api_key_msg"));

// enterStopMode / exitStopMode:
btn.setAttribute("aria-label", t("stop_aria"));   // enterStopMode
btn.setAttribute("aria-label", t("send_aria"));   // exitStopMode

// sendMessage — gemini no image:
fullResponse = t("gemini_no_image");

// sendMessage — retry button:
retryBtn.textContent = t("retry_btn");

// sendMessage — isAuthError check needs to match both languages:
const isAuthError = err.message.includes("ungültig") || err.message.includes("invalid")
  || err.message.includes("Einstellungen") || err.message.includes("settings")
  || err.message.includes("Rechte") || err.message.includes("permissions");

// importConversations:
alert(t("import_json_error"));
alert(t("import_format_error"));
const suffix = imported !== 1 ? t("import_plural_suffix") : "";
alert(t("import_success", imported, suffix));

// updateConversationIndex:
const title = firstUserMessage
  ? firstUserMessage.slice(0, 60) + (firstUserMessage.length > 60 ? "…" : "")
  : t("new_conv_title");

// importConversations:
title: conv.title || t("imported_conv_title"),

// agent confirm bar:
document.getElementById("agent-confirm-text").textContent = t("confirm_prefix", msg.actionText ?? "");

// agent start fail:
agentLog("error", response?.error ?? t("agent_start_fail"));
```

- [ ] **Step 18: Wire language select in `loadSettingsIntoUI` and `saveSettingsFromUI`**

In `loadSettingsIntoUI`, add:
```js
document.getElementById("language-select").value = settings.language || "de";
```

In `saveSettingsFromUI`, add to `newSettings`:
```js
language: document.getElementById("language-select").value,
```

And after `settings = { ...newSettings, _autoDetected: false };`, add:
```js
setLanguage(settings.language || "de");
applyTranslations();
// Notify background.js so it can update context menus
browser.runtime.sendMessage({ type: "LANGUAGE_CHANGED", language: settings.language }).catch(() => {});
```

- [ ] **Step 19: Call `setLanguage` and `applyTranslations` in `init()`**

After `settings = storedSettings;` (around line 343), add:
```js
setLanguage(settings.language || "de");
```

And at the end of `init()`, just before `document.addEventListener("DOMContentLoaded", init)` — actually inside `init()`, after `applyTheme(...)` is called and before `renderEmptyState()` / chatHistory render:
```js
applyTranslations();
```

- [ ] **Step 20: Commit**

```bash
git add "Safari AI Agent Extension/Resources/popup.js"
git commit -m "feat(i18n): wire i18n into popup.js — replace all German strings with t()"
```

---

## Task 5: Wire i18n into `background.js`

**Files:**
- Modify: `Safari AI Agent Extension/Resources/background.js`

- [ ] **Step 1: Add import and language loader at top of `background.js`**

```js
import { t, setLanguage } from "./i18n.js";

async function loadLang() {
  const result = await browser.storage.local.get(["settings"]);
  const lang = result?.settings?.language ?? "de";
  setLanguage(lang);
}
```

- [ ] **Step 2: Replace hardcoded strings in context menu setup**

Replace `MENU_ITEMS` and `PROMPTS`:

```js
// These are now built dynamically — remove the static const declarations and instead
// define a function that returns them:
function getMenuItems() {
  return [
    { id: "ai-explain",   title: t("menu_explain") },
    { id: "ai-translate", title: t("menu_translate") },
    { id: "ai-summarize", title: t("menu_summarize") }
  ];
}

function getPrompts() {
  return {
    "ai-explain":   (text) => t("prompt_explain", text),
    "ai-translate": (text) => t("prompt_translate", text),
    "ai-summarize": (text) => t("prompt_summarize", text)
  };
}
```

- [ ] **Step 3: Update `onInstalled` listener to use `getMenuItems()`**

```js
browser.runtime.onInstalled.addListener(async () => {
  await loadLang();
  browser.contextMenus.removeAll().then(() => {
    for (const item of getMenuItems()) {
      browser.contextMenus.create({
        id: item.id,
        title: item.title,
        contexts: ["selection"]
      });
    }
  });
});
```

- [ ] **Step 4: Update `contextMenus.onClicked` to use `getPrompts()`**

```js
browser.contextMenus.onClicked.addListener(async (info) => {
  await loadLang();
  const buildPrompt = getPrompts()[info.menuItemId];
  if (!buildPrompt || !info.selectionText) return;
  const MAX_SELECTION = 8000;
  const text = info.selectionText.trim().slice(0, MAX_SELECTION);
  const prompt = buildPrompt(text);
  await browser.storage.local.set({ contextMenuPrompt: prompt });
  try {
    await browser.runtime.sendMessage({ type: "CONTEXT_MENU_TEXT", prompt });
  } catch { /* popup not open */ }
});
```

- [ ] **Step 5: Handle `LANGUAGE_CHANGED` message to update context menus**

In the `browser.runtime.onMessage.addListener` block, add a new branch before the `return false`:

```js
if (message.type === "LANGUAGE_CHANGED") {
  setLanguage(message.language ?? "de");
  for (const item of getMenuItems()) {
    browser.contextMenus.update(item.id, { title: item.title }).catch(() => {});
  }
  sendResponse({ ok: true });
  return true;
}
```

- [ ] **Step 6: Replace agent log strings in `runAgentLoop`**

```js
// Add loadLang() at the start of runAgentLoop:
async function runAgentLoop(task, tabId, providerId, model, apiKey, baseUrl) {
  await loadLang();
  notifyPopup({ type: "AGENT_LOG", status: "thinking", text: t("agent_analyzing") });
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "info", text: t("agent_aborted") });
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_screenshot_fail", e.message) });
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_dom_fail", e.message) });
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "info", text: t("agent_aborted") });  // after AbortError
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_ai_fail", e.message) });
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_no_response") });
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "info", text: t("agent_not_confirmed") });
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "success", text: t("agent_done", summary || t("agent_done_default")) });
  // ...
  if (!actionResult?.ok) {
    notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_action_error", action, actionResult?.error ?? t("agent_action_unknown")) });
  }
  // ...
  notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_max_iter", AGENT_MAX_ITERATIONS) });
}
```

Also in the `.catch` at the call site of `runAgentLoop`:
```js
.catch(e => notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_error_prefix", e.message) }))
```

And the `startAgentLoop` error in popup.js (Task 4 Step 17):
```js
agentLog("error", t("agent_no_tab"));
```

- [ ] **Step 7: Replace strings in `buildLogText`**

```js
function buildLogText(aiResponse) {
  const { action, selector, value, direction, summary } = aiResponse;
  if (action === "click")    return t("agent_click_log", selector);
  if (action === "type")     return t("agent_type_log", value, selector);
  if (action === "scroll")   return t("agent_scroll_log", direction);
  if (action === "select")   return t("agent_select_log", value, selector);
  if (action === "navigate") return t("agent_navigate_log", aiResponse.url);
  if (action === "wait")     return t("agent_wait_log", aiResponse.ms);
  if (action === "done")     return t("agent_done", summary || "");
  return action;
}
```

- [ ] **Step 8: Replace agent system prompt and user message in `callAgentAI`**

```js
const systemPrompt = t("agent_sys_prompt");

// Replace the two `text:` strings for userContent (both the Anthropic and OpenAI branches):
const taskText = t("agent_task_label", task, iteration + 1, AGENT_MAX_ITERATIONS, pageUrl, domSummary || t("agent_no_elements"));
// Use taskText wherever the old template literal `Aufgabe: ${task}\nIteration: …` appeared.
```

- [ ] **Step 9: Replace JSON parse error strings in `callAgentAI`**

```js
// Both catch blocks:
throw new Error(t("agent_json_parse_error", stripped.slice(0, 80) + "…"));
```

- [ ] **Step 10: Replace `isSubmitElement` label check**

The regex `/submit|senden|send|abschicken/i` tests label text — add English equivalents (they are already in the regex via `send`/`submit`, so no change needed here).

- [ ] **Step 11: Commit**

```bash
git add "Safari AI Agent Extension/Resources/background.js"
git commit -m "feat(i18n): wire i18n into background.js — replace German strings with t()"
```

---

## Task 6: Verification — grep for remaining hardcoded German strings

**Files:** all Resources JS files

- [ ] **Step 1: Run grep to find any remaining German strings**

```bash
grep -n '"[^"]*[äöüÄÖÜß][^"]*"\|`[^`]*[äöüÄÖÜß]' \
  "Safari AI Agent Extension/Resources/popup.js" \
  "Safari AI Agent Extension/Resources/background.js"
```

Expected output: **zero matches** (except comments and the `i18n.js` file itself which legitimately contains German strings as values).

Also run:
```bash
grep -n '"[^"]*[äöüÄÖÜß][^"]*"\|`[^`]*[äöüÄÖÜß]' \
  "Safari AI Agent Extension/Resources/i18n.js" | wc -l
```
Expected: ≥ 80 (the translation values).

- [ ] **Step 2: Check HTML for remaining untranslated German text**

```bash
grep -n '>[^<]*[äöüÄÖÜß][^<]*<' \
  "Safari AI Agent Extension/Resources/popup.html"
```

Expected output: zero matches (all German text nodes have been replaced with `data-i18n` attributes).

- [ ] **Step 3: Build the extension in Xcode and load it in Safari**

Open the Xcode project, build (⌘B), enable the extension in Safari → Preferences → Extensions, open the popup.

- [ ] **Step 4: Verify German (default) language**

- Open popup → all text in German ✓
- Open Settings → "KI-Anbieter", "Modell", "Einstellungen speichern" visible ✓
- Hover history button → tooltip in German ✓
- Send a message → context notices in German ✓

- [ ] **Step 5: Switch to English**

- Open Settings → select "English" → click "Save settings" (button label switches to "Save settings" after click)
- All UI text now in English ✓
- Close and reopen popup → still English ✓
- Check "Sprache / Language" label — still bilingual ✓

- [ ] **Step 6: Check relative dates**

Switch back to German. Open history dropdown — relative date strings ("Heute", "Gestern", "Vor 3 Tagen") appear in German. Switch to English → "Today", "Yesterday", "3 days ago". ✓

- [ ] **Step 7: Check error messages**

In Settings, enter an invalid API key, try to load models → error message appears in the active language. ✓

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat(i18n): complete German/English language support with settings picker"
```
