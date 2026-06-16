import { t, setLanguage, getLanguage, applyTranslations as _applyTranslations } from "./i18n.js";

function applyTranslations() {
  _applyTranslations(document);
  document.querySelectorAll("[data-i18n-alt]").forEach(el => {
    el.alt = t(el.dataset.i18nAlt);
  });
  document.documentElement.lang = getLanguage();
}

// ── Provider Configuration ────────────────────────────────────
const PROVIDERS = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    streaming: true,
    format: "openai"
  },
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1/messages",
    models: ["claude-sonnet-latest", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    streaming: true,
    format: "anthropic"
  },
  gemini: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    models: ["gemini-1.5-pro", "gemini-1.5-flash"],
    streaming: false,
    format: "gemini"
  },
  local: {
    name: "Lokal (Ollama / LM Studio)",
    baseUrl: null,
    models: [],
    streaming: true,
    format: "openai"
  },
  hyperspace: {
    name: "Hyperspace",
    baseUrl: "http://localhost:6655/litellm/v1",
    models: [],
    streaming: true,
    format: "openai"
  }
};

const DEFAULT_SETTINGS = {
  provider: "hyperspace",
  apiKey: "",
  baseUrl: "http://localhost:6655/litellm/v1",
  model: "",
  customModel: "",
  systemPrompt: "",
  language: "de"
};

// ── Module State ──────────────────────────────────────────────
let settings = { ...DEFAULT_SETTINGS };
let chatHistory = [];
let activeConvId = null;
let isStreaming = false;
let abortController = null;
let currentPageContext = null;
let pageContextMode = "auto"; // "auto" | "on" | "off"
let pageContextUsedInConversation = false;
let lastDisplayedModel = null;
let pendingImageData = null; // { base64: string, mimeType: string } | null
let agentRunning = false;
let welcomeStep = 0;

// ── Storage Helpers ───────────────────────────────────────────
async function loadSettings() {
  const result = await browser.storage.local.get(["settings"]);
  return result.settings ? { ...DEFAULT_SETTINGS, ...result.settings } : { ...DEFAULT_SETTINGS };
}

async function saveSettings(s) {
  await browser.storage.local.set({ settings: s });
}

function generateConvId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Claude Config Auto-Discovery ──────────────────────────────
async function loadAIConfig() {
  try {
    const response = await browser.runtime.sendMessage({ type: "getAIConfig" });
    if (response?.source === "claude-config" && response.apiKey) {
      return {
        apiKey:       response.apiKey,
        baseUrl:      response.baseUrl,
        model:        response.model,
        autoDetected: true
      };
    }
  } catch {
    // Native messaging fehlgeschlagen — Fallback zu gespeicherten Werten
  }

  // Fallback: init() ruft loadSettings() separat auf
  return { autoDetected: false };
}

async function loadConversation(id) {
  const result = await browser.storage.local.get([`conv_${id}`]);
  const msgs = Array.isArray(result[`conv_${id}`]) ? result[`conv_${id}`] : [];
  return msgs
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .map(m => {
      const content = typeof m.content === "string" ? m.content : String(m.content ?? "");
      return { ...m, content: content.length > 10000 ? content.slice(0, 10000) + "…" : content };
    });
}

async function loadConversationsIndex() {
  const result = await browser.storage.local.get(["conversations_index"]);
  return Array.isArray(result.conversations_index) ? result.conversations_index : [];
}

async function saveConversationsIndex(index) {
  await browser.storage.local.set({ conversations_index: index });
}

async function saveConversation(id, messages) {
  const MAX_BYTES = 512 * 1024;
  let trimmed = messages.length > 100 ? messages.slice(messages.length - 100) : [...messages];

  while (trimmed.length > 0) {
    const bytes = new TextEncoder().encode(JSON.stringify(trimmed)).length;
    if (bytes <= MAX_BYTES) break;
    trimmed = trimmed.slice(Math.ceil(trimmed.length * 0.2));
  }

  try {
    await browser.storage.local.set({ [`conv_${id}`]: trimmed });
  } catch {
    try {
      const minimal = trimmed.slice(-4);
      await browser.storage.local.set({ [`conv_${id}`]: minimal });
    } catch { /* ignore — storage full, give up */ }
  }
}

async function updateConversationIndex(id, firstUserMessage) {
  const MAX_CONVERSATIONS = 50;
  let index = await loadConversationsIndex();

  const title = firstUserMessage
    ? firstUserMessage.slice(0, 60) + (firstUserMessage.length > 60 ? "…" : "")
    : t("new_conv_title");

  const existing = index.findIndex(c => c.id === id);
  const entry = existing >= 0
    ? { ...index[existing], updatedAt: Date.now() }
    : { id, title, updatedAt: Date.now() };

  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.unshift(entry);
  }

  // Sort: pinned first (stable), then by updatedAt DESC
  index.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
  // Only unpinned conversations count toward the limit
  const unpinned = index.filter(c => !c.pinned);
  const pinned   = index.filter(c =>  c.pinned);
  const removed  = unpinned.splice(MAX_CONVERSATIONS);
  index = [...pinned, ...unpinned];

  // Delete storage for removed conversations
  for (const conv of removed) {
    try { await browser.storage.local.remove(`conv_${conv.id}`); } catch { /* ignore */ }
  }

  await saveConversationsIndex(index);
}

async function setActiveConvId(id) {
  activeConvId = id;
  await browser.storage.local.set({ active_conv_id: id });
}

async function migrateOldChatHistory() {
  const result = await browser.storage.local.get(["chatHistory", "conversations_index"]);
  // Only migrate if old key exists and no new index yet
  if (!result.chatHistory || result.conversations_index) return;

  const messages = Array.isArray(result.chatHistory) ? result.chatHistory : [];
  if (messages.length === 0) {
    await browser.storage.local.remove("chatHistory");
    return;
  }

  const id = generateConvId();
  await saveConversation(id, messages);
  const firstUser = messages.find(m => m.role === "user");
  await updateConversationIndex(id, firstUser?.content ?? "");
  await setActiveConvId(id);
  await browser.storage.local.remove("chatHistory");
}

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

async function renderHistoryDropdown() {
  const index = await loadConversationsIndex();
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  for (const conv of index) {
    const item = document.createElement("div");
    item.className = "history-item" + (conv.id === activeConvId ? " active" : "");
    item.setAttribute("role", "option");
    item.dataset.convId = conv.id;
    item.style.cssText = "flex-direction:row;align-items:center;gap:8px";

    const textCol = document.createElement("div");
    textCol.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column";

    const titleEl = document.createElement("div");
    titleEl.className = "history-item-title";
    titleEl.textContent = conv.title || t("conv_title_fallback");

    const dateEl = document.createElement("div");
    dateEl.className = "history-item-date";
    dateEl.textContent = formatRelativeDate(conv.updatedAt);

    textCol.appendChild(titleEl);
    textCol.appendChild(dateEl);

    const pinBtn = document.createElement("button");
    pinBtn.className = "history-pin-btn" + (conv.pinned ? " pinned" : "");
    pinBtn.title = conv.pinned ? t("pin_btn_unpin") : t("pin_btn_pin");
    pinBtn.innerHTML = conv.pinned
      ? `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 1L15 6.5l-3.5 1-3 3v3l-2-2-3 3-1-1 3-3-2-2h3l1-3.5z"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 1L15 6.5l-3.5 1-3 3v3l-2-2-3 3-1-1 3-3-2-2h3l1-3.5z"/></svg>`;
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePin(conv.id);
    });

    item.appendChild(textCol);
    item.appendChild(pinBtn);
    list.appendChild(item);
  }
}

async function togglePin(id) {
  let index = await loadConversationsIndex();
  index = index.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c);
  index.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
  await saveConversationsIndex(index);
  await renderHistoryDropdown();
}

function filterHistoryItems(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll("#history-list .history-item").forEach(item => {
    const title = item.querySelector(".history-item-title")?.textContent.toLowerCase() ?? "";
    item.style.display = (!q || title.includes(q)) ? "" : "none";
  });
}

async function openHistoryDropdown() {
  await renderHistoryDropdown();
  document.getElementById("history-dropdown").classList.remove("hidden");
  const searchInput = document.getElementById("history-search");
  if (searchInput) {
    searchInput.value = "";
    filterHistoryItems("");
    searchInput.focus();
  }
}

function closeHistoryDropdown() {
  document.getElementById("history-dropdown").classList.add("hidden");
}

async function switchToConversation(id) {
  if (isStreaming) return;
  closeHistoryDropdown();
  clearPendingImage();
  await setActiveConvId(id);
  chatHistory = await loadConversation(id);
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  if (chatHistory.length === 0) {
    renderEmptyState();
  } else {
    chatHistory.forEach(m => {
      const bubble = renderMessage(m.role === "assistant" ? "ai" : "user", m.content);
      if (m.role === "assistant") requestAnimationFrame(() => highlightCode(bubble));
    });
  }
  currentPageContext = null;
  pageContextUsedInConversation = false;
  if (pageContextMode !== "off") fetchPageContent();
}

// ── Settings UI ───────────────────────────────────────────────
// Stale-while-revalidate model-list cache. Keyed by (provider, baseUrl,
// hasApiKey) — never store the key itself. 5min TTL, plus a monotonic
// call counter so a slow in-flight fetch can't overwrite a newer result.
const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
const modelsCache = new Map(); // cacheKey → { models, ts } OR { result, ts } for non-array
let currentModelCallId = 0;

function modelsCacheKey(providerId) {
  const baseUrl = document.getElementById("base-url-input")?.value.trim() ?? "";
  const hasKey = !!document.getElementById("api-key-input")?.value.trim();
  return `${providerId}|${baseUrl}|${hasKey ? 1 : 0}`;
}

async function populateModelDropdown(providerId) {
  const modelSelect = document.getElementById("model-select");
  const modelCustomInput = document.getElementById("model-custom-input");
  const spinner = document.getElementById("model-spinner");
  const msgEl = document.getElementById("model-fetch-message");

  // Reset message
  msgEl.style.display = "none";
  msgEl.className = "model-fetch-message";
  msgEl.textContent = "";

  // Static-list providers skip fetch entirely
  const staticProviders = ["anthropic", "gemini"];
  if (staticProviders.includes(providerId)) {
    modelSelect.style.display = "block";
    modelCustomInput.style.display = "none";
    modelSelect.disabled = false;
    const staticModels = PROVIDERS[providerId].models;
    modelSelect.innerHTML = staticModels
      .map(m => `<option value="${m}">${m}</option>`)
      .join("");
    if ([...modelSelect.options].some(o => o.value === settings.model)) {
      modelSelect.value = settings.model;
    }
    return;
  }

  // For "local", always make the custom input available — local servers
  // (older Ollama, llama.cpp, …) frequently lack a /v1/models endpoint,
  // and the user must be able to type a model name regardless.
  const isCustom = providerId === "local";
  if (isCustom) {
    modelCustomInput.style.display = "block";
    modelCustomInput.value = settings.customModel || "";
  } else {
    modelCustomInput.style.display = "none";
  }

  modelSelect.style.display = "block";

  // Stale-while-revalidate: if we have a fresh cache hit, use it instantly
  // and skip the spinner/disabled flicker.
  const key = modelsCacheKey(providerId);
  const cached = modelsCache.get(key);
  const isFresh = cached && (Date.now() - cached.ts) < MODELS_CACHE_TTL_MS;

  if (isFresh && Array.isArray(cached.models)) {
    modelSelect.disabled = false;
    modelSelect.innerHTML = cached.models
      .map(m => `<option value="${m}">${m}</option>`)
      .join("");
    if ([...modelSelect.options].some(o => o.value === settings.model)) {
      modelSelect.value = settings.model;
    }
    return;
  }

  // No fresh cache → show loading state
  modelSelect.disabled = true;
  modelSelect.innerHTML = `<option value="">${t("model_loading")}</option>`;
  spinner.style.display = "inline-block";

  const myCallId = ++currentModelCallId;
  const result = await fetchModelsForProvider(providerId);

  // If a newer call has been issued meanwhile, drop this stale result.
  if (myCallId !== currentModelCallId) return;

  spinner.style.display = "none";
  modelSelect.disabled = false;

  if (result === null) return;

  if (Array.isArray(result)) {
    modelsCache.set(key, { models: result, ts: Date.now() });
    modelSelect.innerHTML = result
      .map(m => `<option value="${m}">${m}</option>`)
      .join("");
    if ([...modelSelect.options].some(o => o.value === settings.model)) {
      modelSelect.value = settings.model;
    }
    return;
  }

  // result is { error } or { hint }
  modelSelect.innerHTML = "";
  modelSelect.disabled = true;
  if (result.error) {
    msgEl.className = "model-fetch-message error";
    msgEl.textContent = result.error;
  } else {
    msgEl.className = "model-fetch-message hint";
    msgEl.textContent = result.hint;
  }
  msgEl.style.display = "block";
}

function updateBaseUrlVisibility(providerId) {
  const section = document.getElementById("base-url-section");
  const isCustom = providerId === "local" || providerId === "hyperspace";
  section.style.display = isCustom ? "block" : "none";
}

function updatePageCtrlUI() {
  document.querySelectorAll(".page-ctx-btn").forEach(btn => {
    const isActive = btn.dataset.mode === pageContextMode;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

function loadSettingsIntoUI() {
  document.getElementById("provider-select").value = settings.provider;
  document.getElementById("api-key-input").value = settings.apiKey;
  const defaultBaseUrl = PROVIDERS[settings.provider]?.baseUrl ?? "";
  document.getElementById("base-url-input").value = settings.provider === "hyperspace" ? defaultBaseUrl : (settings.baseUrl || defaultBaseUrl);
  document.getElementById("system-prompt-input").value = settings.systemPrompt;
  const langSelect = document.getElementById("language-select");
  if (langSelect) langSelect.value = settings.language || "de";
  updateBaseUrlVisibility(settings.provider);
  populateModelDropdown(settings.provider);

  // Badge + readonly Felder wenn auto-detected
  const badge = document.getElementById("claude-config-badge");
  const apiKeyInput = document.getElementById("api-key-input");
  const baseUrlInput = document.getElementById("base-url-input");
  const providerSelect = document.getElementById("provider-select");
  const modelSelect = document.getElementById("model-select");

  if (settings._autoDetected) {
    badge.style.display = "flex";
    apiKeyInput.readOnly = true;
    baseUrlInput.readOnly = true;
    providerSelect.disabled = true;
    modelSelect.disabled = true;
  } else {
    badge.style.display = "none";
    apiKeyInput.readOnly = false;
    baseUrlInput.readOnly = false;
    providerSelect.disabled = false;
    modelSelect.disabled = false;
  }
}

async function saveSettingsFromUI() {
  const providerId = document.getElementById("provider-select").value;
  const isCustom = providerId === "local";

  const newSettings = {
    provider: providerId,
    apiKey: document.getElementById("api-key-input").value.trim(),
    baseUrl: document.getElementById("base-url-input").value.trim(),
    model: isCustom ? "" : document.getElementById("model-select").value,
    customModel: isCustom ? document.getElementById("model-custom-input").value.trim() : "",
    systemPrompt: document.getElementById("system-prompt-input").value,
    language: document.getElementById("language-select")?.value || "de"
    // _autoDetected wird bewusst nicht gespeichert
  };

  settings = { ...newSettings, _autoDetected: false };
  await saveSettings(newSettings); // nur newSettings ohne _autoDetected
  lastDisplayedModel = null;
  applyTheme(settings.provider, settings.model);
  setLanguage(settings.language || "de");
  applyTranslations();
  browser.runtime.sendMessage({ type: "LANGUAGE_CHANGED", language: settings.language }).catch(() => {});

  const btn = document.getElementById("save-settings-btn");
  const original = btn.textContent;
  btn.textContent = t("saved_confirm");
  setTimeout(() => { btn.textContent = original; }, 1500);
}

// ── Theme System ──────────────────────────────────────────────
function applyTheme(providerId, model) {
  const m = (model || "").toLowerCase();
  let theme = "default";

  if (providerId === "anthropic") {
    theme = "anthropic";
  } else if (providerId === "openai") {
    theme = "openai";
  } else if (providerId === "gemini") {
    theme = "gemini";
  } else if (providerId === "hyperspace" || providerId === "local") {
    if (m.includes("claude") || m.includes("anthropic")) theme = "anthropic";
    else if (m.includes("gpt") || m.includes("openai")) theme = "openai";
    else if (m.includes("gemini")) theme = "gemini";
    else theme = "default";
  }

  document.documentElement.setAttribute("data-theme", theme);
}

// ── Dark Mode ─────────────────────────────────────────────────
let darkModeEnabled = false;

function applyDarkMode(enabled) {
  darkModeEnabled = enabled;
  if (enabled) {
    document.documentElement.setAttribute("data-color-scheme", "dark");
  } else {
    document.documentElement.removeAttribute("data-color-scheme");
  }
  const sun = document.getElementById("darkmode-icon-sun");
  const moon = document.getElementById("darkmode-icon-moon");
  if (sun && moon) {
    sun.style.display = enabled ? "block" : "none";
    moon.style.display = enabled ? "none" : "block";
  }
  const btn = document.getElementById("darkmode-btn");
  if (btn) btn.setAttribute("aria-pressed", String(enabled));
  const lightTheme = document.getElementById("prism-theme-light");
  const darkTheme = document.getElementById("prism-theme-dark");
  if (lightTheme) lightTheme.disabled = enabled;
  if (darkTheme) darkTheme.disabled = !enabled;
}

async function toggleDarkMode() {
  const next = !darkModeEnabled;
  applyDarkMode(next);
  await browser.storage.local.set({ darkMode: next });
}

function clearPendingImage() {
  pendingImageData = null;
  const wrap = document.getElementById("image-preview-wrap");
  const img  = document.getElementById("image-preview");
  if (wrap) wrap.classList.add("hidden");
  if (img)  img.src = "";
}

function loadImageFile(file) {
  if (!file) return;
  const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (!ALLOWED.includes(file.type)) {
    alert(t("image_type_error"));
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert(t("image_size_error"));
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(",")[1];
    pendingImageData = { base64, mimeType: file.type };
    const wrap = document.getElementById("image-preview-wrap");
    const img  = document.getElementById("image-preview");
    img.src = dataUrl;
    wrap.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function handleGlobalKeydown(e) {
  const meta = e.metaKey || e.ctrlKey;
  // Escape: close dropdown, then settings
  if (e.key === "Escape") {
    const dropdown = document.getElementById("history-dropdown");
    if (!dropdown.classList.contains("hidden")) {
      closeHistoryDropdown();
      return;
    }
    const settingsPanel = document.getElementById("settings-panel");
    if (settingsPanel.classList.contains("active")) {
      closeSettings();
      return;
    }
  }
  // ⌘+K / Ctrl+K → new conversation
  if (meta && e.key === "k") {
    e.preventDefault();
    if (isStreaming) return;
    closeSettings();
    startNewConversation();
    return;
  }
  // ⌘+, / Ctrl+, → settings
  if (meta && e.key === ",") {
    e.preventDefault();
    const settingsPanel = document.getElementById("settings-panel");
    if (settingsPanel.classList.contains("active")) {
      closeSettings();
    } else {
      openSettings();
    }
    return;
  }
}

// ── Debounce Helper ───────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Model Fetching ────────────────────────────────────────────
async function fetchModelsForProvider(providerId) {
  const apiKey = document.getElementById("api-key-input").value.trim();
  const baseUrl = document.getElementById("base-url-input").value.trim();

  if (providerId === "anthropic") return null;
  if (providerId === "gemini") return null;

  if (providerId === "openai") {
    if (!apiKey) return { hint: t("api_hint_enter_key") };
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    if (res.status === 401) return { error: t("api_err_key_invalid") };
    if (!res.ok) return { error: t("api_err_status", res.status) };
    const json = await res.json();
    const models = (json.data ?? [])
      .map(m => m.id)
      .filter(id => id.includes("gpt"))
      .sort();
    return models.length ? models : { error: t("api_err_no_models") };
  }

  // local or hyperspace — OpenAI-compatible /models endpoint
  if (!baseUrl) return { hint: t("api_hint_enter_url") };
  const url = baseUrl.replace(/\/$/, "") + "/models";
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers });
    if (res.status === 401) return { error: t("api_err_key_invalid") };
    if (res.status === 404) return { error: t("api_hint_not_found") };
    if (!res.ok) return { error: t("api_err_status", res.status) };
    const json = await res.json();
    const EMBEDDING_KEYWORDS = ["embedding", "embed", "search", "similarity"];
    const models = (json.data ?? [])
      .map(m => m.id)
      .filter(id => id && !EMBEDDING_KEYWORDS.some(k => id.toLowerCase().includes(k)))
      .sort();
    return models.length ? models : { error: t("api_err_no_models") };
  } catch {
    return { error: t("api_err_load_fail") };
  }
}

// ── Markdown Renderer ─────────────────────────────────────────
// Only http(s), mailto, and relative/anchor URLs may render as links.
// Everything else (javascript:, data:, vbscript:, file:, …) becomes plain
// text so LLM-emitted markdown cannot run code in the extension context.
function sanitizeUrl(href) {
  const trimmed = String(href).trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[\/#?]/.test(trimmed)) return trimmed;
  return null;
}

function markdownToHtml(text) {
  let escaped = String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Stash code blocks and inline code FIRST with NUL-delimited sentinels so
  // none of the inline passes (bold/italic/lists/etc.) see their contents.
  // Without this, e.g. ```\n- a\n- b\n``` gets the list-regex applied to the
  // <pre><code>…</code></pre> body and breaks rendering.
  const codeBlocks = [];
  const inlineCodes = [];

  escaped = escaped.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langClass = lang ? ` class="language-${lang}"` : "";
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code${langClass}>${code.trim()}</code></pre>`);
    return `\x00CB${idx}\x00`;
  });

  escaped = escaped.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${code}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // Bold
  escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  escaped = escaped.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

  // Headings
  escaped = escaped.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, content) => {
    const level = hashes.length;
    return `<h${level}>${content}</h${level}>`;
  });

  // Links — sanitize href, fall back to plain text on dangerous schemes
  escaped = escaped.replace(
    /\[([^\]]+)\]\(([^()\s]+(?:\([^)]*\))?[^()\s]*)\)/g,
    (_, label, href) => {
      const safe = sanitizeUrl(href);
      if (!safe) return label;
      const safeAttr = safe.replace(/"/g, "&quot;");
      return `<a href="${safeAttr}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
  );

  // Horizontal rules — --- or *** or ___ on their own line → <hr>
  escaped = escaped.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "<hr>");

  // Tables — | col | col | with optional separator row |---|---|
  escaped = escaped.replace(/(?:^|\n)((?:\|.+\|\n?)+)/g, (_, block) => {
    const rows = block.trim().split("\n").filter(r => r.trim());
    // Filter out pure separator rows like |---|---|
    const dataRows = rows.filter(r => !/^\|[\s|:-]+\|$/.test(r));
    if (dataRows.length === 0) return "";
    const [headerRow, ...bodyRows] = dataRows;
    const parseCells = row => row.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
    const headerCells = parseCells(headerRow).map(c => `<th>${c}</th>`).join("");
    const bodyHtml = bodyRows.map(r =>
      `<tr>${parseCells(r).map(c => `<td>${c}</td>`).join("")}</tr>`
    ).join("");
    return `\n<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  });

  // Unordered lists
  escaped = escaped.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (_, block) => {
    const items = block
      .split("\n")
      .filter(l => /^- .+/.test(l))
      .map(l => `<li>${l.replace(/^- /, "")}</li>`)
      .join("");
    return `\n<ul>${items}</ul>`;
  });

  // Ordered lists — `1. foo` / `2. bar`
  escaped = escaped.replace(/(?:^|\n)((?:\d+\.\s.+(?:\n|$))+)/g, (_, block) => {
    const items = block
      .split("\n")
      .filter(l => /^\d+\.\s.+/.test(l))
      .map(l => `<li>${l.replace(/^\d+\.\s/, "")}</li>`)
      .join("");
    return `\n<ol>${items}</ol>`;
  });

  // Blockquotes — `> foo`, multiple consecutive lines merged
  escaped = escaped.replace(/(?:^|\n)((?:&gt; ?.*(?:\n|$))+)/g, (_, block) => {
    const inner = block
      .split("\n")
      .map(l => l.replace(/^&gt; ?/, ""))
      .filter(l => l.length)
      .join("<br>");
    return `\n<blockquote>${inner}</blockquote>`;
  });

  // Paragraphs
  escaped = escaped
    .split(/\n{2,}/)
    .map(chunk => {
      const trimmed = chunk.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<pre")
          || trimmed.startsWith("<ul") || trimmed.startsWith("<ol")
          || trimmed.startsWith("<table") || trimmed.startsWith("<hr")
          || trimmed.startsWith("<blockquote")
          || /^<h[1-6][\s>]/.test(trimmed)
          || /^\x00CB\d+\x00$/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  // Restore stashed code last so nothing has touched their bodies.
  escaped = escaped.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[Number(i)] ?? "");
  escaped = escaped.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[Number(i)] ?? "");

  return escaped;
}

function parseQuickReplies(text) {
  const match = text.match(/\[QUICK_REPLIES:\s*([^\]]+)\]/i);
  if (!match) return { text, replies: [] };
  const replies = match[1]
    .split("|")
    .map(r => r.trim())
    .filter(r => r.length > 0)
    .slice(0, 4);
  const cleanText = text.replace(match[0], "").trimEnd();
  return { text: cleanText, replies };
}

function renderQuickReplies(replies, messageRow) {
  if (!replies || replies.length === 0) return;
  const container = document.createElement("div");
  container.className = "quick-replies";
  for (const reply of replies) {
    const btn = document.createElement("button");
    btn.className = "quick-reply-btn";
    btn.textContent = reply;
    btn.addEventListener("click", () => {
      container.remove();
      const input = document.getElementById("user-input");
      input.value = reply;
      sendMessage();
    });
    container.appendChild(btn);
  }
  messageRow.insertAdjacentElement("afterend", container);
  scrollToBottomIfNear();
}

// ── Provider Avatar ───────────────────────────────────────────
function getProviderAvatar() {
  const provider = settings.provider;
  const model = (settings.model || "").toLowerCase();

  // Determine actual provider from model name (for Hyperspace/LiteLLM)
  let resolved = provider;
  if (provider === "hyperspace" || provider === "local") {
    if (model.includes("claude") || model.includes("anthropic")) resolved = "anthropic";
    else if (model.includes("gpt") || model.includes("openai")) resolved = "openai";
    else if (model.includes("gemini")) resolved = "gemini";
    else if (model.includes("sonar") || model.includes("perplexity")) resolved = "perplexity";
  }

  const AVATARS = {
    anthropic: {
      bg: "#f5f0eb",
      img: "images/logo-anthropic.svg"
    },
    openai: {
      bg: "#000000",
      img: "images/logo-openai.png"
    },
    gemini: {
      bg: "#ffffff",
      img: "images/logo-gemini.png"
    },
    perplexity: {
      bg: "#20808d",
      img: null
    },
    hyperspace: {
      bg: "#0070f3",
      img: null
    },
    local: {
      bg: "#6e6e6e",
      img: null
    }
  };

  return AVATARS[resolved] ?? AVATARS.local;
}


function removeEmptyState() {
  const el = document.getElementById("empty-state");
  if (el) el.remove();
}

function scrollToBottom() {
  const list = document.getElementById("messages");
  list.scrollTop = list.scrollHeight;
}

function scrollToBottomIfNear() {
  const list = document.getElementById("messages");
  const threshold = 80;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < threshold;
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

function renderModelTag(modelName) {
  removeEmptyState();
  const tag = document.createElement("div");
  tag.className = "model-tag";
  tag.textContent = modelName || t("no_model_selected");
  document.getElementById("messages").appendChild(tag);
  scrollToBottom();
}

function renderMessage(role, content) {
  removeEmptyState();

  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  if (role === "ai") {
    const avatar = document.createElement("div");
    avatar.className = "ai-avatar";
    const { bg, img } = getProviderAvatar();
    avatar.style.background = bg;
    if (img) {
      const imgEl = document.createElement("img");
      imgEl.src = img;
      imgEl.width = 16;
      imgEl.height = 16;
      imgEl.style.objectFit = "contain";
      imgEl.style.borderRadius = "2px";
      avatar.appendChild(imgEl);
    }
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;

  if (role === "user") {
    bubble.textContent = content;
  } else {
    bubble._rawText = content;
    bubble.innerHTML = markdownToHtml(content);
  }

  row.appendChild(bubble);

  if (role === "ai") {
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.title = t("copy_btn_title");
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(bubble._rawText ?? bubble.textContent).then(() => {
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 1500);
      });
    });
    bubble.appendChild(copyBtn);
  }

  document.getElementById("messages").appendChild(row);
  scrollToBottom();
  return bubble;
}

function renderEmptyState() {
  const messages = document.getElementById("messages");
  if (document.getElementById("empty-state")) return;
  messages.innerHTML = `
    <div id="empty-state" class="empty-state">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 3C8.82 3 3 8.82 3 16c0 2.28.58 4.42 1.6 6.28L3 29l6.72-1.6A13 13 0 1016 3z" stroke="#d3cec6" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
      <p>${t("empty_state_text")}</p>
    </div>`;
}

// ── Page Context Mode Notice ──────────────────────────────────
function renderContextModeNotice(label) {
  removeEmptyState();
  const notice = document.createElement("div");
  notice.className = "model-tag";
  notice.textContent = label;
  document.getElementById("messages").appendChild(notice);
  scrollToBottom();
}

// ── Page Content Fetch ────────────────────────────────────────
async function fetchPageContent() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) { currentPageContext = null; return; }
    const tab = tabs[0];

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

    const data = results?.[0]?.result;
    if (data) {
      currentPageContext = data;
    } else {
      currentPageContext = null;
    }
  } catch (err) {
    currentPageContext = { _debugError: `${err?.name}: ${err?.message}` };
  }
}

// ── Show-Page Detection ───────────────────────────────────────
// Matches phrases like "zeige mir", "öffne die Seite", "geh zu", etc.
const SHOW_PAGE_KEYWORDS_RE = /(?:^|[\s.,!?;:()"'])(?:zeig(?:e)?\s+mir|zeig(?:e)?|öffne|geh\s+(?:zu|auf)|navigiere\s+(?:zu|auf)|besuche|open|show\s+me|go\s+to|visit)(?:[\s.,!?;:()"']|$)/i;

// ── Subpage Auto-Fetch ────────────────────────────────────────
const SUBPAGE_KEYWORDS_RE = /(?:^|[\s.,!?;:()"'])(?:hole|hol|öffne|zeig|lies|lese|fetch|artikel|article|unterseite|subpage|inhalt|mehr\s+dazu|vollständig|was\s+steht\s+(?:im|in\s+dem|dort|da))(?:[\s.,!?;:()"']|$)/i;

async function classifySubpageNeed(text) {
  const providerId = settings.provider;
  // customModel is only persisted for the "local" provider — hyperspace uses
  // settings.model populated from /v1/models. Reading customModel for it
  // always yields "" and the !model guard below would silently disable the
  // classifier.
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return false;
  // local and hyperspace do not require an API key (LiteLLM/Ollama).
  if (!settings.apiKey && providerId !== "local" && providerId !== "hyperspace") return false;
  if ((providerId === "local" || providerId === "hyperspace") && !settings.baseUrl) return false;

  const systemMsg = t("sys_classify_yn");
  const userMsg = t("sys_classify_subpage", text);

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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
      });
    } else {
      const url = (providerId === "local" || providerId === "hyperspace")
        ? settings.baseUrl.replace(/\/$/, "") + "/chat/completions"
        : PROVIDERS.openai.baseUrl;
      const headers = { "Content-Type": "application/json" };
      // Only attach Authorization when a key is set — `Bearer ` with empty
      // token is rejected by some LiteLLM/nginx proxies.
      if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;
      classifyPromise = fetch(url, {
        method: "POST",
        headers,
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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
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

// ── URL Extraction ────────────────────────────────────────────
function extractUrlFromText(text) {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) return null;
  return match[0].replace(/[.,)\]]+$/, "");
}

// ── Background Tab Fetch ──────────────────────────────────────
async function fetchUrlContent(url, { active = false, keepOpen = false } = {}) {
  let tabId = null;
  try {
    const tab = await browser.tabs.create({ url, active });
    tabId = tab.id;

    await new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(onUpdated);
      };
      function onUpdated(id, info) {
        if (id !== tabId) return;
        if (info.status === "complete") {
          cleanup();
          resolve();
        }
      }
      timer = setTimeout(() => {
        // Always remove the listener on timeout — otherwise it accumulates
        // for the popup's lifetime and fires on every browser-wide tab update.
        cleanup();
        reject(new Error("timeout"));
      }, 10000);
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
    if (tabId !== null && !keepOpen) {
      try { await browser.tabs.remove(tabId); } catch { /* ignore */ }
    }
  }
}

// ── Relevant Link Selection ───────────────────────────────────
async function selectRelevantLinks(rootContent, links, question) {
  if (!links || links.length === 0) return [];

  const providerId = settings.provider;
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return [];

  const systemMsg = t("sys_classify_links");
  const linkList = links.slice(0, 50).join("\n");
  const userMsg = t("sys_links_user", rootContent.title, rootContent.url, rootContent.text.slice(0, 3000), linkList, question);

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

// ── Page-Context Detection ────────────────────────────────────
const PAGE_KEYWORDS_RE = /\b(diese[rn]?\s+(?:seite|artikel|text|inhalt|webseite)|was\s+steht\s+(?:hier|da|dort)|(?:hier|da|dort)\s+steht|auf\s+der\s+(?:seite|webseite)|den\s+text|dem\s+artikel|fasse\s+zusammen|zusammenfassung|der\s+webseite|der\s+seite|übersetze\s+(?:das|den|die|mir)|erkläre\s+mir\s+das|this\s+page|the\s+article|what\s+does\s+it\s+say|summarize\s+this|translate\s+this)\b/i;

function keywordCheck(text) {
  return PAGE_KEYWORDS_RE.test(text);
}

async function classifyWithAI(text) {
  const providerId = settings.provider;
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return false;
  // local and hyperspace do not require an API key (LiteLLM/Ollama).
  if (!settings.apiKey && providerId !== "local" && providerId !== "hyperspace") return false;
  if ((providerId === "local" || providerId === "hyperspace") && !settings.baseUrl) return false;

  const systemMsg = t("sys_classify_yn");
  const userMsg = t("sys_classify_page", text);

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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
      });
    } else {
      // OpenAI-compatible (openai, local, hyperspace)
      const url = (providerId === "local" || providerId === "hyperspace")
        ? settings.baseUrl.replace(/\/$/, "") + "/chat/completions"
        : PROVIDERS.openai.baseUrl;
      const headers = { "Content-Type": "application/json" };
      if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;
      classifyPromise = fetch(url, {
        method: "POST",
        headers,
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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
      });
    }

    return await Promise.race([classifyPromise, timeout]);
  } catch {
    return false;
  }
}

async function shouldIncludePageContext(text) {
  if (!currentPageContext || currentPageContext._debugError) return false;
  if (pageContextUsedInConversation) return true;
  if (keywordCheck(text)) { pageContextUsedInConversation = true; return true; }
  const result = await classifyWithAI(text);
  if (result) pageContextUsedInConversation = true;
  return result;
}

// ── Uncertainty Detection ─────────────────────────────────────
async function uncertaintyCheck(text) {
  const providerId = settings.provider;
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return false;
  if (!settings.apiKey && providerId !== "local" && providerId !== "hyperspace") return false;

  const systemMsg = t("sys_classify_yn");
  const userMsg = t("sys_classify_uncertainty", text);

  const timeout = new Promise(resolve => setTimeout(() => resolve(false), 4000));

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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
      });
    } else {
      // OpenAI-compatible (openai, local, hyperspace)
      const url = (providerId === "local" || providerId === "hyperspace")
        ? settings.baseUrl.replace(/\/$/, "") + "/chat/completions"
        : PROVIDERS.openai.baseUrl;
      const headers = { "Content-Type": "application/json" };
      if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;
      classifyPromise = fetch(url, {
        method: "POST",
        headers,
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
        return answer.includes(t("sys_classify_yn_answer")) || answer.includes("yes") || answer.includes("ja");
      });
    }

    return await Promise.race([classifyPromise, timeout]);
  } catch {
    return false;
  }
}

// ── Web Context Fetch (Perplexity via Hyperspace) ─────────────
async function fetchWebContext(question) {
  if (settings.provider !== "hyperspace" && settings.provider !== "local") return null;
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

// ── System Prompt Builder ─────────────────────────────────────
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

// ── SSE Parser ────────────────────────────────────────────────
async function* parseSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE allows \n, \r, or \r\n line endings
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) yield line.slice(6).trim();
    }
  }
}

// ── API Error Helper ──────────────────────────────────────────
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

// ── OpenAI / Local / Hyperspace Streaming ────────────────────
async function* streamOpenAI(messages, signal, imageData = null) {
  const providerId = settings.provider;
  const provider = PROVIDERS[providerId];
  const url = (providerId === "local" || providerId === "hyperspace")
    ? settings.baseUrl.replace(/\/$/, "") + "/chat/completions"
    : provider.baseUrl;
  const model = providerId === "local"
    ? settings.customModel
    : settings.model;

  const headers = { "Content-Type": "application/json" };
  // Only attach Authorization when a key is actually present — some local
  // servers (LiteLLM/nginx proxies) reject `Bearer ` with an empty token.
  if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: buildOpenAIMessagesWithImage(messages, imageData), stream: true, max_tokens: 2048 }),
    signal
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(friendlyApiError("OpenAI", response.status, err));
  }

  for await (const data of parseSSE(response)) {
    if (data === "[DONE]") return;
    try {
      const json = JSON.parse(data);
      const token = json.choices?.[0]?.delta?.content;
      if (token) yield token;
    } catch { /* skip malformed chunks */ }
  }
}

// ── Anthropic Streaming ───────────────────────────────────────
// Anthropic requires strictly alternating user/assistant messages and the
// first non-system message must be `user`. Merge consecutive same-role
// messages and drop a leading assistant message if present.
function normalizeAnthropicMessages(messages) {
  const filtered = messages.filter(m => m.role !== "system");
  // Drop leading assistant message(s) — API rejects them as the first turn
  while (filtered.length > 0 && filtered[0].role === "assistant") filtered.shift();
  const merged = [];
  for (const m of filtered) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      merged.push({ role: m.role, content: m.content });
    }
  }
  return merged;
}

function buildAnthropicMessagesWithImage(messages, imageData) {
  const normalized = normalizeAnthropicMessages(messages);
  if (!imageData) return normalized;
  const last = normalized[normalized.length - 1];
  if (!last || last.role !== "user") return normalized;
  return [...normalized.slice(0, -1), {
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: imageData.mimeType,
          data: imageData.base64
        }
      },
      { type: "text", text: last.content }
    ]
  }];
}

function buildOpenAIMessagesWithImage(messages, imageData) {
  if (!imageData) return messages;
  const copy = messages.map(m => ({ ...m }));
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === "user") {
      copy[i] = {
        role: "user",
        content: [
          { type: "text", text: copy[i].content },
          {
            type: "image_url",
            image_url: { url: `data:${imageData.mimeType};base64,${imageData.base64}` }
          }
        ]
      };
      break;
    }
  }
  return copy;
}

async function* streamAnthropic(messages, includeCtx = false, webContext = null, signal, imageData = null) {
  const systemPrompt = buildSystemPrompt(includeCtx, webContext);
  const userMessages = buildAnthropicMessagesWithImage(messages, imageData);

  const response = await fetch(settings.baseUrl || PROVIDERS.anthropic.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "anthropic-dangerous-allow-browser": "true"
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: userMessages,
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(friendlyApiError("Anthropic", response.status, err));
  }

  for await (const data of parseSSE(response)) {
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data);
      if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
        yield json.delta.text;
      }
      if (json.type === "message_stop") return;
    } catch { /* skip */ }
  }
}

// ── Gemini REST ───────────────────────────────────────────────
async function callGemini(messages, includeCtx = false, webContext = null, signal) {
  const systemPrompt = buildSystemPrompt(includeCtx, webContext);
  const model = settings.model;
  const url = PROVIDERS.gemini.baseUrl.replace("{model}", model) + `?key=${settings.apiKey}`;

  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: 2048 }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(friendlyApiError("Gemini", response.status, err));
  }

  const json = await response.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? t("gemini_no_response");
}

// ── Streaming Flush Helper ────────────────────────────────────
// Throttle is intentionally ~120ms (not 50ms) — at 30 tok/s the human eye
// doesn't perceive 8 vs 20 renders/s, and reparsing markdown on every tick
// is O(N²) over the accumulated text. nearBottom is captured BEFORE the
// innerHTML write so the layout-thrash check uses the pre-write geometry.
function makeStreamFlusher(getBubble, getResponse) {
  let timer = null;
  function flush() {
    timer = null;
    const bubble = getBubble();
    if (!bubble) return;
    const list = document.getElementById("messages");
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    requestAnimationFrame(() => {
      const text = getResponse();
      bubble.innerHTML = markdownToHtml(text);
      bubble._rawText = text;
      if (nearBottom) list.scrollTop = list.scrollHeight;
    });
  }
  function schedule() {
    if (!timer) timer = setTimeout(flush, 120);
  }
  function finalize() {
    if (timer) { clearTimeout(timer); timer = null; }
    flush();
  }
  return { schedule, finalize };
}

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

function highlightCode(bubble) {
  if (!bubble || typeof window.Prism === "undefined") return;
  try {
    window.Prism.highlightAllUnder(bubble);
    bubble.querySelectorAll("pre:not([data-copy-wired])").forEach(pre => {
      pre.setAttribute("data-copy-wired", "1");
      const code = pre.querySelector("code");
      if (!code) return;
      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.textContent = t("code_copy_btn");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(code.textContent).then(() => {
          btn.textContent = "✓";
          setTimeout(() => { btn.textContent = t("code_copy_btn"); }, 1500);
        });
      });
      pre.appendChild(btn);
    });
  } catch { /* ignore — highlight failure is cosmetic */ }
}

// ── Web-Search Fallback ───────────────────────────────────────
// Runs after sendMessage()'s finally block so the send button is re-enabled
// immediately after the main AI response. Fire-and-forget from sendMessage.
async function runWebSearchFallback({ providerId, history, text, includeCtx, fullResponse, convIdAtSend }) {
  // Only supported on hyperspace / local
  if (providerId !== "hyperspace" && providerId !== "local") return;
  if (!fullResponse) return;

  const isUncertain = await uncertaintyCheck(fullResponse);
  if (!isUncertain) return;

  // If the user switched conversations meanwhile, persist into the snapshot
  // conversation without mutating the active UI. We re-load that conv's
  // history fresh from storage, append, and save — never overwriting the
  // newly-active conversation's storage.
  const isStillActive = convIdAtSend === activeConvId;

  const typingEl = document.getElementById("typing-indicator");
  if (isStillActive) {
    renderContextModeNotice(t("ctx_web_search"));
    typingEl.classList.remove("hidden");
    typingEl.removeAttribute("aria-hidden");
    scrollToBottom();
  }

  const webContext = await fetchWebContext(text);

  if (isStillActive) {
    typingEl.classList.add("hidden");
    typingEl.setAttribute("aria-hidden", "true");
  }

  if (!webContext) return;

  let webMessages;
  const webSystemPrompt = buildSystemPrompt(includeCtx, webContext);
  if (providerId === "anthropic" || providerId === "gemini") {
    webMessages = history.map(m => ({ role: m.role, content: m.content }));
  } else {
    webMessages = [
      { role: "system", content: webSystemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content }))
    ];
  }

  let webBubble = null;
  let webResponse = "";

  if (providerId === "gemini") {
    webResponse = await callGemini(webMessages, includeCtx, webContext);
    if (isStillActive) {
      webBubble = renderMessage("ai", webResponse);
      renderKatex(webBubble);
      highlightCode(webBubble);
    }
  } else {
    const webGenerator = providerId === "anthropic"
      ? streamAnthropic(webMessages, includeCtx, webContext)
      : streamOpenAI(webMessages);

    let firstWebToken = true;
    const webFlusher = makeStreamFlusher(() => webBubble, () => webResponse);
    for await (const token of webGenerator) {
      if (firstWebToken) {
        if (convIdAtSend === activeConvId) webBubble = renderMessage("ai", "");
        firstWebToken = false;
      }
      webResponse += token;
      if (webBubble) webFlusher.schedule();
    }
    if (webBubble) {
      webFlusher.finalize();
      requestAnimationFrame(() => renderKatex(webBubble));
      requestAnimationFrame(() => highlightCode(webBubble));
    }
  }

  if (!webResponse) return;

  if (convIdAtSend === activeConvId) {
    chatHistory.push({ role: "assistant", content: webResponse });
    await saveConversation(activeConvId, chatHistory);
    const firstUser = chatHistory.find(m => m.role === "user");
    await updateConversationIndex(activeConvId, firstUser?.content ?? "");
  } else {
    // User switched conversations — persist into snapshot conv without touching UI
    const stored = await loadConversation(convIdAtSend);
    stored.push({ role: "assistant", content: webResponse });
    await saveConversation(convIdAtSend, stored);
    const firstUser = stored.find(m => m.role === "user");
    await updateConversationIndex(convIdAtSend, firstUser?.content ?? "");
  }
}

// ── Stop Button Helpers ───────────────────────────────────────
function enterStopMode() {
  const btn = document.getElementById("send-btn");
  btn.classList.add("stop-mode");
  btn.disabled = false;
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="white" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="10" height="10" rx="2"/></svg>`;
  btn.setAttribute("aria-label", t("stop_aria"));
  // Mute the messages region during streaming so VoiceOver doesn't read
  // every flushed token. Re-announces cleanly on exitStopMode.
  const messages = document.getElementById("messages");
  if (messages) messages.setAttribute("aria-busy", "true");
}

function exitStopMode() {
  const btn = document.getElementById("send-btn");
  btn.classList.remove("stop-mode");
  btn.setAttribute("aria-label", t("send_aria"));
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 8h12M9 3l5 5-5 5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const messages = document.getElementById("messages");
  if (messages) messages.removeAttribute("aria-busy");
}

// ── Send Message ──────────────────────────────────────────────
async function sendMessage() {
  if (isStreaming) return;

  const input = document.getElementById("user-input");
  const text = input.value.trim();
  if (!text) return;

  // Guard: no API key (hyperspace and local don't need one).
  // Check BEFORE clearing pending image / consuming input — so the user can
  // open settings, fix the key, and re-send the same message + image.
  if (!settings.apiKey && settings.provider !== "local" && settings.provider !== "hyperspace") {
    renderMessage("ai", t("no_api_key_msg"));
    return;
  }

  isStreaming = true;
  abortController = new AbortController();
  enterStopMode();

  let aiBubble = null;
  let fullResponse = "";
  let flusher = null;
  let snapshotForWebSearch = null;
  const typingEl = document.getElementById("typing-indicator");

  try {
    input.value = "";
    input.style.height = "auto";
    const imageDataSnapshot = pendingImageData;
    clearPendingImage();

    // Show model tag if model changed since last message
    const currentModel = settings.model || settings.customModel || "?";
    if (currentModel !== lastDisplayedModel) {
      const providerName = settings.provider === "local" ? t("provider_local") : (PROVIDERS[settings.provider]?.name ?? settings.provider);
      // Strip vendor prefixes like "anthropic--" or "openai/" for readability
      const displayModel = currentModel.replace(/^[a-z]+--/i, "").replace(/^[a-z]+\//i, "");
      renderModelTag(`${providerName} · ${displayModel}`);
      lastDisplayedModel = currentModel;
    }

    chatHistory.push({ role: "user", content: text });
    renderMessage("user", text);

    const typingAvatar = typingEl.querySelector(".ai-avatar");
    const { bg, img } = getProviderAvatar();
    if (typingAvatar) {
      typingAvatar.style.background = bg;
      typingAvatar.innerHTML = "";
      if (img) {
        const imgEl = document.createElement("img");
        imgEl.src = img;
        imgEl.width = 16; imgEl.height = 16;
        imgEl.style.cssText = "object-fit:contain;border-radius:2px";
        typingAvatar.appendChild(imgEl);
      }
    }
    typingEl.classList.remove("hidden");
    typingEl.removeAttribute("aria-hidden");
    scrollToBottom();

    const providerId = settings.provider;

    // ── URL Fetch Agent ───────────────────────────────────────
    const detectedUrl = pageContextMode !== "off" ? extractUrlFromText(text) : null;
    if (detectedUrl) {
      const showPage = SHOW_PAGE_KEYWORDS_RE.test(text);
      renderContextModeNotice(showPage ? t("ctx_page_opening") : t("ctx_page_loading"));
      scrollToBottom();
      const rootContent = await fetchUrlContent(detectedUrl, { active: showPage, keepOpen: showPage });
      if (rootContent) {
        if (rootContent.links && rootContent.links.length > 0) {
          renderContextModeNotice(t("ctx_subpages_search"));
          scrollToBottom();
          const selectedUrls = await selectRelevantLinks(rootContent, rootContent.links, text);
          if (selectedUrls.length > 0) {
            const subpages = (await Promise.all(selectedUrls.map(u => fetchUrlContent(u)))).filter(Boolean);
            if (subpages.length > 0) {
              rootContent.text += "\n\n" + subpages
                .map(p => `---\n${p.title}\n${p.url}\n${p.text}`)
                .join("\n\n");
            }
          }
        }
        // Preserve links so the subpage-auto-fetch path below can run on
        // follow-up turns within the same conversation.
        currentPageContext = {
          text: rootContent.text,
          title: rootContent.title,
          url: rootContent.url,
          links: rootContent.links
        };
        pageContextUsedInConversation = true;
      }
    }
    // ─────────────────────────────────────────────────────────

    // ── Subpage Auto-Fetch ────────────────────────────────────
    if (!detectedUrl && currentPageContext?.links?.length > 0 && pageContextMode !== "off") {
      const showPage = SHOW_PAGE_KEYWORDS_RE.test(text);
      const shouldLoad = showPage || await shouldLoadSubpages(text);
      if (shouldLoad) {
        renderContextModeNotice(showPage ? t("ctx_subpage_opening") : t("ctx_subpages_loading"));
        scrollToBottom();
        const selectedUrls = await selectRelevantLinks(currentPageContext, currentPageContext.links, text);
        if (selectedUrls.length > 0) {
          const fetchOpts = showPage && selectedUrls.length === 1
            ? { active: true, keepOpen: true }
            : {};
          const subpages = (await Promise.all(selectedUrls.map(u => fetchUrlContent(u, fetchOpts)))).filter(Boolean);
          if (subpages.length > 0) {
            const subText = subpages
              .map(p => `---\n${p.title}\n${p.url}\n${p.text.slice(0, 3000)}`)
              .join("\n\n");
            currentPageContext = { ...currentPageContext, text: currentPageContext.text + "\n\n" + subText };
            pageContextUsedInConversation = true;
            renderContextModeNotice(showPage && selectedUrls.length === 1
              ? t("ctx_page_opened", subpages[0].title)
              : t("ctx_subpages_loaded", subpages.length, subpages.length > 1 ? t("ctx_subpage_plural") : ""));
            scrollToBottom();
          } else {
            renderContextModeNotice("");
          }
        } else {
          renderContextModeNotice("");
        }
      }
    }
    // ─────────────────────────────────────────────────────────

    const includeCtx = pageContextMode === "on"
      ? true
      : pageContextMode === "off"
        ? false
        : await shouldIncludePageContext(text);

    let messages;
    if (providerId === "anthropic" || providerId === "gemini") {
      messages = chatHistory.map(m => ({ role: m.role, content: m.content }));
    } else {
      messages = [
        { role: "system", content: buildSystemPrompt(includeCtx) },
        ...chatHistory.map(m => ({ role: m.role, content: m.content }))
      ];
    }

    if (providerId === "gemini") {
      if (imageDataSnapshot) {
        typingEl.classList.add("hidden");
        typingEl.setAttribute("aria-hidden", "true");
        fullResponse = t("gemini_no_image");
        aiBubble = renderMessage("ai", fullResponse);
      } else {
        fullResponse = await callGemini(messages, includeCtx, null, abortController.signal);
        typingEl.classList.add("hidden");
        typingEl.setAttribute("aria-hidden", "true");

        // Quick Replies — parse BEFORE first render so markdown only runs once
        const { text: cleanGeminiText, replies: geminiReplies } = parseQuickReplies(fullResponse);
        if (geminiReplies.length > 0) fullResponse = cleanGeminiText;
        aiBubble = renderMessage("ai", fullResponse);
        if (geminiReplies.length > 0) {
          renderQuickReplies(geminiReplies, aiBubble.closest(".message-row"));
        }
        renderKatex(aiBubble);
        highlightCode(aiBubble);
      }
    } else {
      const generator = providerId === "anthropic"
        ? streamAnthropic(messages, includeCtx, null, abortController.signal, imageDataSnapshot)
        : streamOpenAI(messages, abortController.signal, imageDataSnapshot);

      let firstToken = true;
      flusher = makeStreamFlusher(() => aiBubble, () => fullResponse);
      for await (const token of generator) {
        if (firstToken) {
          typingEl.classList.add("hidden");
          typingEl.setAttribute("aria-hidden", "true");
          aiBubble = renderMessage("ai", "");
          firstToken = false;
        }
        fullResponse += token;
        flusher.schedule();
      }
      flusher.finalize();

      // Quick Replies — parse from full response, strip marker BEFORE
      // re-rendering so markdownToHtml only runs once over cleanText
      if (aiBubble && fullResponse) {
        const { text: cleanText, replies } = parseQuickReplies(fullResponse);
        if (replies.length > 0) {
          fullResponse = cleanText;
          aiBubble.innerHTML = markdownToHtml(cleanText);
          aiBubble._rawText = cleanText;
          renderQuickReplies(replies, aiBubble.closest(".message-row"));
        }
      }

      requestAnimationFrame(() => renderKatex(aiBubble));
      requestAnimationFrame(() => highlightCode(aiBubble));
    }

    const historyBeforeFirstReply = [...chatHistory]; // snapshot before first reply
    chatHistory.push({ role: "assistant", content: fullResponse });
    await saveConversation(activeConvId, chatHistory);
    const firstUser = chatHistory.find(m => m.role === "user");
    await updateConversationIndex(activeConvId, firstUser?.content ?? "");

    // Snapshot for web-search fallback — runs after finally (outside try block)
    snapshotForWebSearch = {
      providerId,
      history: historyBeforeFirstReply,
      text,
      includeCtx,
      fullResponse,
      convIdAtSend: activeConvId
    };

  } catch (err) {
    typingEl.classList.add("hidden");
    typingEl.setAttribute("aria-hidden", "true");
    if (err.name !== "AbortError") {
      const errBubble = renderMessage("ai", err.message);
      const isAuthError = err.message.includes("ungültig") || err.message.includes("invalid")
        || err.message.includes("Einstellungen") || err.message.includes("settings")
        || err.message.includes("Rechte") || err.message.includes("permissions");
      if (!isAuthError) {
        const retryBtn = document.createElement("button");
        retryBtn.className = "quick-reply-btn";
        retryBtn.textContent = t("retry_btn");
        retryBtn.addEventListener("click", () => {
          retryBtn.closest(".quick-replies")?.remove();
          const input = document.getElementById("user-input");
          input.value = text;
          sendMessage();
        });
        const retryContainer = document.createElement("div");
        retryContainer.className = "quick-replies";
        retryContainer.appendChild(retryBtn);
        errBubble.closest(".message-row").insertAdjacentElement("afterend", retryContainer);
      }
    }
    // On abort: save partial response if we have one
    if (err.name === "AbortError" && aiBubble && fullResponse) {
      flusher?.finalize();
      chatHistory.push({ role: "assistant", content: fullResponse });
      await saveConversation(activeConvId, chatHistory);
      const firstUser = chatHistory.find(m => m.role === "user");
      await updateConversationIndex(activeConvId, firstUser?.content ?? "");
    }
  } finally {
    isStreaming = false;
    abortController = null;
    exitStopMode();
    // Re-enable only if there's something to send — input is empty after a
    // successful send, so leaving it disabled until the user types is correct.
    document.getElementById("send-btn").disabled = input.value.trim().length === 0;
    input.focus();
  }

  // Web-search fallback runs after button is re-enabled — fire and forget
  if (snapshotForWebSearch?.fullResponse) {
    runWebSearchFallback(snapshotForWebSearch);
  }
}

// ── Welcome Onboarding ────────────────────────────────────────
async function checkWelcome() {
  const { welcome_seen } = await browser.storage.local.get("welcome_seen");
  if (!welcome_seen) showWelcomeOverlay();
}

function showWelcomeOverlay() {
  welcomeStep = 0;
  const overlay = document.getElementById("welcome-overlay");
  overlay.classList.remove("hidden");
  showWelcomeStep(0);
  applyTranslations(overlay);
}

function showWelcomeStep(n) {
  welcomeStep = n;
  document.querySelectorAll(".welcome-step").forEach((el, i) => {
    el.classList.toggle("hidden", i !== n);
  });
  document.querySelectorAll(".welcome-dot").forEach((el, i) => {
    el.classList.toggle("active", i === n);
  });
  const nextBtn = document.getElementById("welcome-next-btn");
  const isLast = n === 3;
  nextBtn.classList.toggle("setup", isLast);
  nextBtn.dataset.i18n = isLast ? "welcome_btn_setup" : "welcome_btn_next";
  nextBtn.textContent = t(nextBtn.dataset.i18n);
  const skipBtn = document.getElementById("welcome-skip-btn");
  skipBtn.dataset.i18n = isLast ? "welcome_btn_later" : "welcome_btn_skip";
  skipBtn.textContent = t(skipBtn.dataset.i18n);
}

function advanceWelcome() {
  if (welcomeStep < 3) {
    showWelcomeStep(welcomeStep + 1);
  } else {
    dismissWelcome(true);
  }
}

async function dismissWelcome(openSettingsAfter = false) {
  await browser.storage.local.set({ welcome_seen: true });
  document.getElementById("welcome-overlay").classList.add("hidden");
  if (openSettingsAfter) openSettings();
}

// ── Panel Navigation ──────────────────────────────────────────
function openSettings() {
  closeHistoryDropdown();
  document.getElementById("chat-panel").classList.add("slide-left");
  document.getElementById("settings-panel").classList.add("active");
  loadSettingsIntoUI();
}

function closeSettings() {
  document.getElementById("settings-panel").classList.remove("active");
  document.getElementById("chat-panel").classList.remove("slide-left");
}

// ── Event Handlers ────────────────────────────────────────────
function onInputKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResizeTextarea(e) {
  const el = e.target;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
  document.getElementById("send-btn").disabled = el.value.trim().length === 0;
}

function toggleKeyVisibility() {
  const input = document.getElementById("api-key-input");
  input.type = input.type === "password" ? "text" : "password";
}

function onProviderChange() {
  const providerId = document.getElementById("provider-select").value;
  updateBaseUrlVisibility(providerId);
  const baseUrlInput = document.getElementById("base-url-input");
  const defaultUrl = PROVIDERS[providerId]?.baseUrl ?? "";
  if (defaultUrl) {
    baseUrlInput.value = defaultUrl;
  } else if (!baseUrlInput.value.trim()) {
    baseUrlInput.value = "";
  }
  applyTheme(providerId, "");
  populateModelDropdown(providerId);
}

async function clearHistory() {
  if (isStreaming) return;
  chatHistory = [];
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
  try {
    await saveConversation(activeConvId, []);
    // Remove from index since it's now empty
    let index = await loadConversationsIndex();
    index = index.filter(c => c.id !== activeConvId);
    await saveConversationsIndex(index);
    await setActiveConvId(generateConvId()); // fresh ID so next send is a new conv
  } catch { /* ignore */ }
}

async function exportConversations() {
  const index = await loadConversationsIndex();
  if (index.length === 0) {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), conversations: [] }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-agent-export-${today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  // Bulk-fetch all conv_<id> keys in a single storage roundtrip — saves
  // (N-1) IPC hops compared to looping loadConversation.
  const keys = index.map(e => `conv_${e.id}`);
  const stored = await browser.storage.local.get(keys);
  const conversations = index.map(entry => {
    const raw = Array.isArray(stored[`conv_${entry.id}`]) ? stored[`conv_${entry.id}`] : [];
    const messages = raw
      .filter(m => m && (m.role === "user" || m.role === "assistant"))
      .map(m => {
        const content = typeof m.content === "string" ? m.content : String(m.content ?? "");
        return { ...m, content: content.length > 10000 ? content.slice(0, 10000) + "…" : content };
      });
    return { ...entry, messages };
  });
  const payload = { version: 1, exportedAt: Date.now(), conversations };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ai-agent-export-${today}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importConversations(file) {
  if (!file) return;
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    alert(t("import_json_error"));
    return;
  }
  if (!payload?.conversations || !Array.isArray(payload.conversations)) {
    alert(t("import_format_error"));
    return;
  }

  const existingIndex = await loadConversationsIndex();
  const existingIds = new Set(existingIndex.map(c => c.id));
  let imported = 0;

  for (const conv of payload.conversations) {
    if (!conv.id || existingIds.has(conv.id)) continue;
    if (!Array.isArray(conv.messages) || conv.messages.length === 0) continue;
    await saveConversation(conv.id, conv.messages);
    existingIndex.unshift({
      id: conv.id,
      title: conv.title || t("imported_conv_title"),
      updatedAt: conv.updatedAt || Date.now(),
      ...(conv.pinned ? { pinned: true } : {})
    });
    existingIds.add(conv.id);
    imported++;
  }

  existingIndex.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
  // Enforce 50-conversation cap (pinned entries exempt)
  const MAX_CONVERSATIONS = 50;
  const pinnedEntries   = existingIndex.filter(c => c.pinned);
  const unpinnedEntries = existingIndex.filter(c => !c.pinned);
  const removedEntries  = unpinnedEntries.splice(MAX_CONVERSATIONS);
  for (const conv of removedEntries) {
    try { await browser.storage.local.remove(`conv_${conv.id}`); } catch { /* ignore */ }
  }
  await saveConversationsIndex([...pinnedEntries, ...unpinnedEntries]);

  const suffix = imported !== 1 ? t("import_plural_suffix") : "";
  alert(t("import_success", imported, suffix));
}

async function startNewConversation() {
  if (isStreaming) return;
  if (chatHistory.length === 0) return; // guard: don't create empty conv
  clearPendingImage();

  const newId = generateConvId();
  await setActiveConvId(newId);
  chatHistory = [];
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
  currentPageContext = null;
  pageContextUsedInConversation = false;
  if (pageContextMode !== "off") fetchPageContent();
}

function refreshModels() {
  const providerId = document.getElementById("provider-select").value;
  // Manual refresh button → drop cache entry so fetch is forced.
  modelsCache.delete(modelsCacheKey(providerId));
  populateModelDropdown(providerId);
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  // Single batch read of every storage key the cold-open path needs.
  // 8 separate awaits → 1 IPC roundtrip; saves ~30-90ms on Safari popups.
  const [aiConfig, storedSettings, batch] = await Promise.all([
    loadAIConfig(),
    loadSettings(),
    browser.storage.local.get([
      "pageContextMode",
      "active_conv_id",
      "conversations_index",
      "darkMode",
      "contextMenuPrompt",
      "chatHistory"
    ])
  ]);

  settings = storedSettings;
  setLanguage(settings.language || "de");

  // Auto-detected Werte überschreiben manuelle (auto hat Vorrang)
  if (aiConfig.autoDetected) {
    settings.apiKey = aiConfig.apiKey;
    settings.baseUrl = aiConfig.baseUrl;
    settings.model = aiConfig.model;
    settings.provider = "anthropic"; // ~/.claude/ ist immer Anthropic
  }

  // Badge-Status in UI-State merken
  settings._autoDetected = aiConfig.autoDetected;

  const validModes = ["auto", "on", "off"];
  pageContextMode = validModes.includes(batch.pageContextMode) ? batch.pageContextMode : "auto";
  updatePageCtrlUI();

  // Migrate old chatHistory key only if present and no new index exists yet.
  // Reads/writes are kept in migrateOldChatHistory itself; we just decide
  // here whether to call it based on the batched values.
  let convId = batch.active_conv_id;
  let index = Array.isArray(batch.conversations_index) ? batch.conversations_index : [];

  if (batch.chatHistory && !batch.conversations_index) {
    await migrateOldChatHistory();
    // Re-read post-migration values (cheap — single roundtrip)
    const post = await browser.storage.local.get(["active_conv_id", "conversations_index"]);
    convId = post.active_conv_id;
    index = Array.isArray(post.conversations_index) ? post.conversations_index : [];
  }

  // Validate that active ID still exists in index
  if (!convId || !index.find(c => c.id === convId)) {
    convId = generateConvId();
    await setActiveConvId(convId);
  } else {
    activeConvId = convId;
  }

  chatHistory = await loadConversation(activeConvId);
  applyTheme(settings.provider, settings.model);
  applyTranslations();
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  applyDarkMode(batch.darkMode !== undefined ? batch.darkMode === true : prefersDark);

  if (chatHistory.length === 0) {
    renderEmptyState();
  } else {
    chatHistory.forEach(m => {
      const bubble = renderMessage(m.role === "assistant" ? "ai" : "user", m.content);
      if (m.role === "assistant") requestAnimationFrame(() => highlightCode(bubble));
    });
  }

  if (pageContextMode !== "off") fetchPageContent();

  document.getElementById("send-btn").addEventListener("click", () => {
    if (isStreaming && abortController) {
      abortController.abort();
    } else {
      sendMessage();
    }
  });
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("darkmode-btn").addEventListener("click", toggleDarkMode);
  document.getElementById("back-btn").addEventListener("click", closeSettings);
  document.getElementById("save-settings-btn").addEventListener("click", saveSettingsFromUI);
  document.getElementById("clear-history-btn").addEventListener("click", clearHistory);
  document.getElementById("export-btn").addEventListener("click", exportConversations);
  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });
  document.getElementById("import-file-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importConversations(file);
    e.target.value = "";
  });
  document.getElementById("toggle-key-btn").addEventListener("click", toggleKeyVisibility);
  document.getElementById("provider-select").addEventListener("change", onProviderChange);
  document.getElementById("user-input").addEventListener("keydown", onInputKeydown);
  document.getElementById("user-input").addEventListener("input", autoResizeTextarea);

  document.getElementById("attach-btn").addEventListener("click", () => {
    document.getElementById("image-file-input").click();
  });
  document.getElementById("image-file-input").addEventListener("change", (e) => {
    loadImageFile(e.target.files?.[0]);
    e.target.value = "";
  });
  document.getElementById("image-remove-btn").addEventListener("click", clearPendingImage);

  document.getElementById("user-input").addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  document.getElementById("user-input").addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) loadImageFile(file);
  });
  document.getElementById("new-chat-btn").addEventListener("click", startNewConversation);
  document.getElementById("refresh-models-btn").addEventListener("click", refreshModels);
  document.addEventListener("keydown", handleGlobalKeydown);

  document.getElementById("history-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (isStreaming) return;
    const dropdown = document.getElementById("history-dropdown");
    if (dropdown.classList.contains("hidden")) {
      openHistoryDropdown();
    } else {
      closeHistoryDropdown();
    }
  });

  document.getElementById("new-conv-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    closeHistoryDropdown();
    startNewConversation();
  });

  document.getElementById("history-list").addEventListener("click", (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;
    switchToConversation(item.dataset.convId);
  });

  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("history-dropdown");
    if (!dropdown.classList.contains("hidden") &&
        !dropdown.contains(e.target) &&
        e.target.id !== "history-btn") {
      closeHistoryDropdown();
    }
  });

  document.getElementById("page-ctx-control").addEventListener("click", async (e) => {
    const btn = e.target.closest(".page-ctx-btn");
    if (!btn) return;
    const newMode = btn.dataset.mode;
    if (newMode === pageContextMode) return;
    pageContextMode = newMode;
    updatePageCtrlUI();
    await browser.storage.local.set({ pageContextMode });

    const MODE_LABELS = { auto: t("ctx_mode_auto"), on: t("ctx_mode_on"), off: t("ctx_mode_off") };
    renderContextModeNotice(MODE_LABELS[pageContextMode] ?? pageContextMode);
  });

  const debouncedRefetchModels = debounce(() => {
    const providerId = document.getElementById("provider-select").value;
    populateModelDropdown(providerId);
  }, 500);

  // base-url: re-fetch on every keystroke (debounced) — typical change is paste
  document.getElementById("base-url-input").addEventListener("input", debouncedRefetchModels);
  // api-key: only on commit (blur) so intermediate partial keys don't trigger
  // 401-storms. Use `change` instead of `input` for that.
  document.getElementById("api-key-input").addEventListener("change", () => {
    const providerId = document.getElementById("provider-select").value;
    populateModelDropdown(providerId);
  });

  document.getElementById("history-search").addEventListener("input", (e) => {
    filterHistoryItems(e.target.value);
  });
  document.getElementById("history-search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      const dropdown = document.getElementById("history-dropdown");
      if (!dropdown.classList.contains("hidden")) closeHistoryDropdown();
    }
  });

  // Check if launched via context menu — use value from initial batch read
  if (batch.contextMenuPrompt) {
    await browser.storage.local.remove("contextMenuPrompt");
    document.getElementById("user-input").value = batch.contextMenuPrompt;
    document.getElementById("send-btn").disabled = false;
    document.getElementById("user-input").focus();
  }

  // Listen for context menu messages while popup is open
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CONTEXT_MENU_TEXT" && msg.prompt) {
      document.getElementById("user-input").value = msg.prompt;
      document.getElementById("send-btn").disabled = false;
      document.getElementById("user-input").focus();
    }
  });
  initAgentTab();
  document.getElementById("welcome-next-btn").addEventListener("click", advanceWelcome);
  document.getElementById("welcome-skip-btn").addEventListener("click", () => dismissWelcome(false));
  await checkWelcome();
}

// ── Agent Section ─────────────────────────────────────────────
function openAgentSection() {
  const body = document.getElementById("agent-section-body");
  const toggle = document.getElementById("agent-toggle");
  body.classList.remove("hidden");
  toggle.setAttribute("aria-expanded", "true");
}

function toggleAgentSection() {
  const body = document.getElementById("agent-section-body");
  const toggle = document.getElementById("agent-toggle");
  const isOpen = !body.classList.contains("hidden");
  body.classList.toggle("hidden", isOpen);
  toggle.setAttribute("aria-expanded", String(!isOpen));
}

function agentLog(status, text) {
  const log = document.getElementById("agent-log");
  const entry = document.createElement("div");
  entry.className = `agent-log-entry status-${status}`;
  const icon = document.createElement("span");
  icon.className = "agent-log-icon";
  const textSpan = document.createElement("span");
  textSpan.textContent = text;
  entry.appendChild(icon);
  entry.appendChild(textSpan);
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function setAgentRunning(running) {
  agentRunning = running;
  document.getElementById("agent-start-btn").disabled = running;
  document.getElementById("agent-stop-btn").classList.toggle("hidden", !running);
  document.getElementById("agent-start-btn").classList.toggle("hidden", running);
}

async function startAgentLoop() {
  if (agentRunning) return;
  const taskInput = document.getElementById("agent-task-input");
  const task = taskInput.value.trim();
  if (!task) return;

  openAgentSection();
  document.getElementById("agent-log").innerHTML = "";
  document.getElementById("agent-confirm-bar").classList.add("hidden");
  setAgentRunning(true);

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs?.[0]?.id;
    if (tabId == null) { agentLog("error", t("agent_no_tab")); setAgentRunning(false); return; }

    const response = await browser.runtime.sendMessage({
      type: "AGENT_START",
      task,
      tabId,
      providerId: settings.provider,
      model: settings.model || settings.customModel,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl
    });

    if (!response?.ok) {
      agentLog("error", response?.error ?? t("agent_start_fail"));
      setAgentRunning(false);
    }
  } catch (e) {
    agentLog("error", e?.message ?? String(e));
    setAgentRunning(false);
  }
}

function stopAgentLoop() {
  setAgentRunning(false);
  document.getElementById("agent-confirm-bar").classList.add("hidden");
  browser.runtime.sendMessage({ type: "AGENT_STOP" }).catch(() => {});
}

function initAgentTab() {
  document.getElementById("agent-toggle").addEventListener("click", toggleAgentSection);
  document.getElementById("agent-start-btn").addEventListener("click", startAgentLoop);
  document.getElementById("agent-stop-btn").addEventListener("click", stopAgentLoop);

  document.getElementById("agent-confirm-yes").addEventListener("click", () => {
    document.getElementById("agent-confirm-bar").classList.add("hidden");
    browser.runtime.sendMessage({ type: "AGENT_CONFIRM_RESPONSE", confirmed: true });
  });

  document.getElementById("agent-confirm-no").addEventListener("click", () => {
    document.getElementById("agent-confirm-bar").classList.add("hidden");
    browser.runtime.sendMessage({ type: "AGENT_CONFIRM_RESPONSE", confirmed: false });
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "AGENT_LOG") { agentLog(msg.status, msg.text); return; }
    if (msg.type === "AGENT_DONE") { setAgentRunning(false); return; }
    if (msg.type === "AGENT_CONFIRM_REQUEST") {
      document.getElementById("agent-confirm-text").textContent = t("confirm_prefix", msg.actionText ?? "");
      document.getElementById("agent-confirm-bar").classList.remove("hidden");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
