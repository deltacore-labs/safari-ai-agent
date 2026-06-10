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
  systemPrompt: ""
};

// ── Module State ──────────────────────────────────────────────
let settings = { ...DEFAULT_SETTINGS };
let chatHistory = [];
let activeConvId = null;
let isStreaming = false;
let abortController = null;
let currentPageContext = null;
let pageContextMode = "auto"; // "auto" | "on" | "off"
let lastDisplayedModel = null;

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
    : "Neue Unterhaltung";

  const existing = index.findIndex(c => c.id === id);
  const entry = existing >= 0
    ? { ...index[existing], updatedAt: Date.now() }
    : { id, title, updatedAt: Date.now() };

  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.unshift(entry);
  }

  // Sort newest first and enforce max limit
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  const removed = index.splice(MAX_CONVERSATIONS);

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
  if (diffDays === 0) return "Heute";
  if (diffDays === 1) return "Gestern";
  if (diffDays < 7) return `Vor ${diffDays} Tagen`;
  if (diffDays < 30) return `Vor ${Math.floor(diffDays / 7)} Woche${Math.floor(diffDays / 7) > 1 ? "n" : ""}`;
  return `Vor ${Math.floor(diffDays / 30)} Monat${Math.floor(diffDays / 30) > 1 ? "en" : ""}`;
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

    const titleEl = document.createElement("div");
    titleEl.className = "history-item-title";
    titleEl.textContent = conv.title || "Unterhaltung";

    const dateEl = document.createElement("div");
    dateEl.className = "history-item-date";
    dateEl.textContent = formatRelativeDate(conv.updatedAt);

    item.appendChild(titleEl);
    item.appendChild(dateEl);
    list.appendChild(item);
  }
}

async function openHistoryDropdown() {
  await renderHistoryDropdown();
  document.getElementById("history-dropdown").classList.remove("hidden");
}

function closeHistoryDropdown() {
  document.getElementById("history-dropdown").classList.add("hidden");
}

async function switchToConversation(id) {
  if (isStreaming) return;
  closeHistoryDropdown();
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
  if (pageContextMode !== "off") fetchPageContent();
}

// ── Settings UI ───────────────────────────────────────────────
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

  // Show loading state
  modelSelect.style.display = "block";
  modelSelect.disabled = true;
  modelSelect.innerHTML = `<option value="">Modelle werden geladen…</option>`;
  spinner.style.display = "inline-block";

  const result = await fetchModelsForProvider(providerId);

  spinner.style.display = "none";
  modelSelect.disabled = false;

  if (result === null) return;

  if (Array.isArray(result)) {
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
    btn.classList.toggle("active", btn.dataset.mode === pageContextMode);
  });
}

function loadSettingsIntoUI() {
  document.getElementById("provider-select").value = settings.provider;
  document.getElementById("api-key-input").value = settings.apiKey;
  const defaultBaseUrl = PROVIDERS[settings.provider]?.baseUrl ?? "";
  document.getElementById("base-url-input").value = settings.provider === "hyperspace" ? defaultBaseUrl : (settings.baseUrl || defaultBaseUrl);
  document.getElementById("system-prompt-input").value = settings.systemPrompt;
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
    systemPrompt: document.getElementById("system-prompt-input").value
    // _autoDetected wird bewusst nicht gespeichert
  };

  settings = { ...newSettings, _autoDetected: false };
  await saveSettings(newSettings); // nur newSettings ohne _autoDetected
  lastDisplayedModel = null;
  applyTheme(settings.provider, settings.model);

  const btn = document.getElementById("save-settings-btn");
  const original = btn.textContent;
  btn.textContent = "Gespeichert ✓";
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
    if (!apiKey) return { hint: "API-Key eingeben um Modelle zu laden" };
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    if (res.status === 401) return { error: "API-Key ungültig" };
    if (!res.ok) return { error: `Fehler ${res.status}` };
    const json = await res.json();
    const models = (json.data ?? [])
      .map(m => m.id)
      .filter(id => id.includes("gpt"))
      .sort();
    return models.length ? models : { error: "Keine Modelle gefunden" };
  }

  // local or hyperspace — OpenAI-compatible /models endpoint
  if (!baseUrl) return { hint: "Base URL eingeben um Modelle zu laden" };
  const url = baseUrl.replace(/\/$/, "") + "/models";
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers });
    if (res.status === 401) return { error: "API-Key ungültig" };
    if (res.status === 404) return { error: "Base URL nicht gefunden" };
    if (!res.ok) return { error: `Fehler ${res.status}` };
    const json = await res.json();
    const EMBEDDING_KEYWORDS = ["embedding", "embed", "search", "similarity"];
    const models = (json.data ?? [])
      .map(m => m.id)
      .filter(id => id && !EMBEDDING_KEYWORDS.some(k => id.toLowerCase().includes(k)))
      .sort();
    return models.length ? models : { error: "Keine Modelle gefunden" };
  } catch {
    return { error: "Modelle konnten nicht geladen werden" };
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

  // Code blocks (must come before inline code) — preserve language as class
  escaped = escaped.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langClass = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${langClass}>${code.trim()}</code></pre>`;
  });

  // Inline code
  escaped = escaped.replace(/`([^`\n]+)`/g, "<code>$1</code>");

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

  escaped = escaped.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (_, block) => {
    const items = block
      .split("\n")
      .filter(l => /^- .+/.test(l))
      .map(l => `<li>${l.replace(/^- /, "")}</li>`)
      .join("");
    return `\n<ul>${items}</ul>`;
  });

  // Paragraphs
  escaped = escaped
    .split(/\n{2,}/)
    .map(chunk => {
      const trimmed = chunk.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<pre") || trimmed.startsWith("<ul") || trimmed.startsWith("<table") || trimmed.startsWith("<hr") || /^<h[1-6][\s>]/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

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
  tag.textContent = modelName || "Kein Modell ausgewählt";
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
    copyBtn.title = "Kopieren";
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
      <p>Stelle mir eine Frage zu dieser Seite oder irgendeinem anderen Thema.</p>
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
        return {
          text: rawText.length > 50000 ? rawText.slice(0, 50000) + "\n...[truncated]" : rawText,
          title: document.title,
          url: window.location.href
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

// ── Page-Context Detection ────────────────────────────────────
const PAGE_KEYWORDS_RE = /\b(diese[rn]?\s+(?:seite|artikel|text|inhalt)|was\s+steht\s+(?:hier|da|dort)|(?:hier|da|dort)\s+steht|auf\s+der\s+seite|den\s+text|dem\s+artikel|fasse\s+zusammen|übersetze\s+(?:das|den|die|mir)|erkläre\s+mir\s+das|this\s+page|the\s+article|what\s+does\s+it\s+say|summarize\s+this|translate\s+this)\b/i;

function keywordCheck(text) {
  return PAGE_KEYWORDS_RE.test(text);
}

async function classifyWithAI(text) {
  const providerId = settings.provider;
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return false;
  if (!settings.apiKey && providerId !== "local") return false;
  if ((providerId === "local" || providerId === "hyperspace") && !settings.baseUrl) return false;

  const systemMsg = "Antworte ausschließlich mit 'ja' oder 'nein', ohne Erklärung.";
  const userMsg = `Bezieht sich diese Frage auf den Inhalt einer bestimmten Webseite, die der Nutzer gerade geöffnet hat? Frage: ${text}`;

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
      // OpenAI-compatible (openai, local, hyperspace)
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

async function shouldIncludePageContext(text) {
  if (!currentPageContext || currentPageContext._debugError) return false;
  if (keywordCheck(text)) return true;
  return await classifyWithAI(text);
}

// ── Uncertainty Detection ─────────────────────────────────────
async function uncertaintyCheck(text) {
  const providerId = settings.provider;
  const model = providerId === "local" ? settings.customModel : settings.model;
  if (!model) return false;
  if (!settings.apiKey && providerId !== "local" && providerId !== "hyperspace") return false;

  const systemMsg = "Antworte ausschließlich mit 'ja' oder 'nein', ohne Erklärung.";
  const userMsg = `Signalisiert der folgende Text, dass das KI-Modell keine aktuellen oder zuverlässigen Informationen zu dem Thema hat (z.B. wegen Trainingsdaten-Cutoff, fehlendem Internetzugang, oder Wissenslücken zu aktuellen Ereignissen)? Text: ${text}`;

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
        return answer.includes("ja") || answer.includes("yes");
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
  const base = settings.systemPrompt?.trim() ||
    "Du bist ein hilfreicher KI-Assistent.";

  const quickRepliesInstruction = "Wenn du dem Nutzer mehrere Optionen anbieten möchtest, kannst du am Ende deiner Antwort bis zu 4 klickbare Vorschläge mit folgendem Format hinzufügen: [QUICK_REPLIES: Option A | Option B | Option C]";

  const now = new Date();
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let prompt = `${base}\n\n${quickRepliesInstruction}\n\nAktuelles Datum: ${dateStr}.`;

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

// ── OpenAI / Local / Hyperspace Streaming ────────────────────
async function* streamOpenAI(messages, signal) {
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
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 2048 }),
    signal
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${err}`);
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

async function* streamAnthropic(messages, includeCtx = false, webContext = null, signal) {
  const systemPrompt = buildSystemPrompt(includeCtx, webContext);
  const userMessages = normalizeAnthropicMessages(messages);

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
    throw new Error(`Anthropic API ${response.status}: ${err}`);
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
    throw new Error(`Gemini API ${response.status}: ${err}`);
  }

  const json = await response.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "(Keine Antwort)";
}

// ── Streaming Flush Helper ────────────────────────────────────
function makeStreamFlusher(getBubble, getResponse) {
  let timer = null;
  function flush() {
    timer = null;
    const bubble = getBubble();
    if (!bubble) return;
    requestAnimationFrame(() => {
      const text = getResponse();
      bubble.innerHTML = markdownToHtml(text);
      bubble._rawText = text;
      const list = document.getElementById("messages");
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      if (nearBottom) list.scrollTop = list.scrollHeight;
    });
  }
  function schedule() {
    if (!timer) timer = setTimeout(flush, 50);
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
      btn.textContent = "Kopieren";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(code.textContent).then(() => {
          btn.textContent = "✓";
          setTimeout(() => { btn.textContent = "Kopieren"; }, 1500);
        });
      });
      pre.appendChild(btn);
    });
  } catch { /* ignore — highlight failure is cosmetic */ }
}

// ── Web-Search Fallback ───────────────────────────────────────
// Runs after sendMessage()'s finally block so the send button is re-enabled
// immediately after the main AI response. Fire-and-forget from sendMessage.
async function runWebSearchFallback({ providerId, history, text, includeCtx, fullResponse }) {
  // Only supported on hyperspace / local
  if (providerId !== "hyperspace" && providerId !== "local") return;
  if (!fullResponse) return;

  const isUncertain = await uncertaintyCheck(fullResponse);
  if (!isUncertain) return;

  const typingEl = document.getElementById("typing-indicator");
  renderContextModeNotice("Websuche wird durchgeführt…");
  typingEl.classList.remove("hidden");
  typingEl.removeAttribute("aria-hidden");
  scrollToBottom();

  const webContext = await fetchWebContext(text);

  typingEl.classList.add("hidden");
  typingEl.setAttribute("aria-hidden", "true");

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
    webBubble = renderMessage("ai", webResponse);
    renderKatex(webBubble);
    highlightCode(webBubble);
  } else {
    const webGenerator = providerId === "anthropic"
      ? streamAnthropic(webMessages, includeCtx, webContext)
      : streamOpenAI(webMessages);

    let firstWebToken = true;
    const webFlusher = makeStreamFlusher(() => webBubble, () => webResponse);
    for await (const token of webGenerator) {
      if (firstWebToken) {
        webBubble = renderMessage("ai", "");
        firstWebToken = false;
      }
      webResponse += token;
      webFlusher.schedule();
    }
    webFlusher.finalize();
    requestAnimationFrame(() => renderKatex(webBubble));
    requestAnimationFrame(() => highlightCode(webBubble));
  }

  if (webResponse) {
    chatHistory.push({ role: "assistant", content: webResponse });
    await saveConversation(activeConvId, chatHistory);
    const firstUser = chatHistory.find(m => m.role === "user");
    await updateConversationIndex(activeConvId, firstUser?.content ?? "");
  }
}

// ── Stop Button Helpers ───────────────────────────────────────
function enterStopMode() {
  const btn = document.getElementById("send-btn");
  btn.classList.add("stop-mode");
  btn.disabled = false;
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="white" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="10" height="10" rx="2"/></svg>`;
  btn.setAttribute("aria-label", "Abbrechen");
}

function exitStopMode() {
  const btn = document.getElementById("send-btn");
  btn.classList.remove("stop-mode");
  btn.setAttribute("aria-label", "Senden");
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 8h12M9 3l5 5-5 5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ── Send Message ──────────────────────────────────────────────
async function sendMessage() {
  if (isStreaming) return;

  const input = document.getElementById("user-input");
  const text = input.value.trim();
  if (!text) return;

  isStreaming = true;
  abortController = new AbortController();
  enterStopMode();
  input.value = "";
  input.style.height = "auto";

  // Show model tag if model changed since last message
  const currentModel = settings.model || settings.customModel || "?";
  if (currentModel !== lastDisplayedModel) {
    const providerName = PROVIDERS[settings.provider]?.name ?? settings.provider;
    // Strip vendor prefixes like "anthropic--" or "openai/" for readability
    const displayModel = currentModel.replace(/^[a-z]+--/i, "").replace(/^[a-z]+\//i, "");
    renderModelTag(`${providerName} · ${displayModel}`);
    lastDisplayedModel = currentModel;
  }

  // Guard: no API key (hyperspace and local don't need one)
  if (!settings.apiKey && settings.provider !== "local" && settings.provider !== "hyperspace") {
    isStreaming = false;
    abortController = null;
    exitStopMode();
    document.getElementById("send-btn").disabled = input.value.trim().length === 0;
    renderMessage("ai", "Bitte zuerst einen API-Key in den Einstellungen hinterlegen.");
    return;
  }

  chatHistory.push({ role: "user", content: text });
  renderMessage("user", text);

  const typingEl = document.getElementById("typing-indicator");
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

  let aiBubble = null;
  let fullResponse = "";
  let flusher = null;
  let snapshotForWebSearch = null;

  try {
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
      fullResponse = await callGemini(messages, includeCtx, null, abortController.signal);
      typingEl.classList.add("hidden");
      typingEl.setAttribute("aria-hidden", "true");
      aiBubble = renderMessage("ai", fullResponse);

      // Quick Replies — parse BEFORE KaTeX so re-setting innerHTML doesn't undo KaTeX
      if (aiBubble && fullResponse) {
        const { text: cleanGeminiText, replies: geminiReplies } = parseQuickReplies(fullResponse);
        if (geminiReplies.length > 0) {
          fullResponse = cleanGeminiText;
          aiBubble.innerHTML = markdownToHtml(cleanGeminiText);
          aiBubble._rawText = cleanGeminiText;
          renderQuickReplies(geminiReplies, aiBubble.closest(".message-row"));
        }
      }
      renderKatex(aiBubble);
      highlightCode(aiBubble);
    } else {
      const generator = providerId === "anthropic"
        ? streamAnthropic(messages, includeCtx, null, abortController.signal)
        : streamOpenAI(messages, abortController.signal);

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
      requestAnimationFrame(() => renderKatex(aiBubble));
      requestAnimationFrame(() => highlightCode(aiBubble));

      // Quick Replies — parse from full response, strip marker from displayed bubble
      if (aiBubble && fullResponse) {
        const { text: cleanText, replies } = parseQuickReplies(fullResponse);
        if (replies.length > 0) {
          fullResponse = cleanText;
          aiBubble.innerHTML = markdownToHtml(cleanText);
          aiBubble._rawText = cleanText;
          renderQuickReplies(replies, aiBubble.closest(".message-row"));
        }
      }
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
      fullResponse
    };

  } catch (err) {
    typingEl.classList.add("hidden");
    typingEl.setAttribute("aria-hidden", "true");
    if (err.name !== "AbortError") {
      renderMessage("ai", `Fehler: ${err.message}`);
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

async function startNewConversation() {
  if (chatHistory.length === 0) return; // guard: don't create empty conv

  const newId = generateConvId();
  await setActiveConvId(newId);
  chatHistory = [];
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
  currentPageContext = null;
  if (pageContextMode !== "off") fetchPageContent();
}

function refreshModels() {
  const providerId = document.getElementById("provider-select").value;
  populateModelDropdown(providerId);
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  const aiConfig = await loadAIConfig();
  settings = await loadSettings();

  // Auto-detected Werte überschreiben manuelle (auto hat Vorrang)
  if (aiConfig.autoDetected) {
    settings.apiKey = aiConfig.apiKey;
    settings.baseUrl = aiConfig.baseUrl;
    settings.model = aiConfig.model;
    settings.provider = "anthropic"; // ~/.claude/ ist immer Anthropic
  }

  // Badge-Status in UI-State merken
  settings._autoDetected = aiConfig.autoDetected;

  const stored = await browser.storage.local.get(["pageContextMode"]);
  const validModes = ["auto", "on", "off"];
  pageContextMode = validModes.includes(stored.pageContextMode) ? stored.pageContextMode : "auto";
  updatePageCtrlUI();
  await migrateOldChatHistory();

  const storedId = await browser.storage.local.get(["active_conv_id"]);
  const index = await loadConversationsIndex();

  let convId = storedId.active_conv_id;
  // Validate that active ID still exists in index
  if (!convId || !index.find(c => c.id === convId)) {
    convId = generateConvId();
    await setActiveConvId(convId);
  } else {
    activeConvId = convId;
  }

  chatHistory = await loadConversation(activeConvId);
  applyTheme(settings.provider, settings.model);
  const dmResult = await browser.storage.local.get(["darkMode"]);
  applyDarkMode(dmResult.darkMode === true);

  if (chatHistory.length === 0) {
    renderEmptyState();
  } else {
    chatHistory.forEach(m =>
      renderMessage(m.role === "assistant" ? "ai" : "user", m.content)
    );
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
  document.getElementById("toggle-key-btn").addEventListener("click", toggleKeyVisibility);
  document.getElementById("provider-select").addEventListener("change", onProviderChange);
  document.getElementById("user-input").addEventListener("keydown", onInputKeydown);
  document.getElementById("user-input").addEventListener("input", autoResizeTextarea);
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

    const MODE_LABELS = { auto: "Seitenkontext: Auto", on: "Seitenkontext: Seite", off: "Seitenkontext: Aus" };
    renderContextModeNotice(MODE_LABELS[pageContextMode] ?? pageContextMode);
  });

  const debouncedRefetchModels = debounce(() => {
    const providerId = document.getElementById("provider-select").value;
    populateModelDropdown(providerId);
  }, 300);

  document.getElementById("base-url-input").addEventListener("input", debouncedRefetchModels);
  document.getElementById("api-key-input").addEventListener("input", debouncedRefetchModels);
}

document.addEventListener("DOMContentLoaded", init);
