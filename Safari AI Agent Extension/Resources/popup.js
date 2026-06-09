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
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
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
    baseUrl: null,
    models: [],
    streaming: true,
    format: "openai"
  }
};

const DEFAULT_SETTINGS = {
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: "gpt-4o",
  customModel: "",
  systemPrompt: ""
};

// ── Module State ──────────────────────────────────────────────
let settings = { ...DEFAULT_SETTINGS };
let chatHistory = [];
let isStreaming = false;
let currentPageContext = null;
let pageToggleEnabled = true;

// ── Storage Helpers ───────────────────────────────────────────
async function loadSettings() {
  const result = await browser.storage.local.get(["settings"]);
  return result.settings ? { ...DEFAULT_SETTINGS, ...result.settings } : { ...DEFAULT_SETTINGS };
}

async function saveSettings(s) {
  await browser.storage.local.set({ settings: s });
}

async function loadHistory() {
  const result = await browser.storage.local.get(["chatHistory"]);
  return Array.isArray(result.chatHistory) ? result.chatHistory : [];
}

async function saveHistory(h) {
  const trimmed = h.length > 100 ? h.slice(h.length - 100) : h;
  await browser.storage.local.set({ chatHistory: trimmed });
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

  // Show loading state
  modelSelect.style.display = "block";
  modelCustomInput.style.display = "none";
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

function loadSettingsIntoUI() {
  document.getElementById("provider-select").value = settings.provider;
  document.getElementById("api-key-input").value = settings.apiKey;
  document.getElementById("base-url-input").value = settings.baseUrl;
  document.getElementById("system-prompt-input").value = settings.systemPrompt;
  updateBaseUrlVisibility(settings.provider);
  populateModelDropdown(settings.provider);

  const isCustom = settings.provider === "local" || settings.provider === "hyperspace";
  if (isCustom) {
    document.getElementById("model-custom-input").value = settings.customModel;
  } else {
    const select = document.getElementById("model-select");
    if ([...select.options].some(o => o.value === settings.model)) {
      select.value = settings.model;
    }
  }
}

async function saveSettingsFromUI() {
  const providerId = document.getElementById("provider-select").value;
  const isCustom = providerId === "local" || providerId === "hyperspace";

  const newSettings = {
    provider: providerId,
    apiKey: document.getElementById("api-key-input").value.trim(),
    baseUrl: document.getElementById("base-url-input").value.trim(),
    model: isCustom ? "" : document.getElementById("model-select").value,
    customModel: isCustom ? document.getElementById("model-custom-input").value.trim() : "",
    systemPrompt: document.getElementById("system-prompt-input").value
  };

  settings = newSettings;
  await saveSettings(settings);

  const btn = document.getElementById("save-settings-btn");
  const original = btn.textContent;
  btn.textContent = "Gespeichert ✓";
  setTimeout(() => { btn.textContent = original; }, 1500);
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
    const models = (json.data ?? []).map(m => m.id).filter(Boolean).sort();
    return models.length ? models : { error: "Keine Modelle gefunden" };
  } catch {
    return { error: "Modelle konnten nicht geladen werden" };
  }
}

// ── Markdown Renderer ─────────────────────────────────────────
function markdownToHtml(text) {
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (must come before inline code)
  escaped = escaped.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${code.trim()}</code></pre>`
  );

  // Inline code
  escaped = escaped.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Bold
  escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  escaped = escaped.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

  // Links
  escaped = escaped.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );

  // Unordered lists
  escaped = escaped.replace(/((?:^|- .+\n?)+)/gm, (block) => {
    const lines = block.split("\n").filter(l => /^- .+/.test(l));
    if (lines.length === 0) return block;
    const items = lines.map(l => `<li>${l.replace(/^- /, "")}</li>`).join("");
    return `<ul>${items}</ul>`;
  });

  // Paragraphs
  escaped = escaped
    .split(/\n{2,}/)
    .map(chunk => {
      if (chunk.startsWith("<pre") || chunk.startsWith("<ul")) return chunk;
      return `<p>${chunk.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  return escaped;
}

// ── Message Rendering ─────────────────────────────────────────
function removeEmptyState() {
  const el = document.getElementById("empty-state");
  if (el) el.remove();
}

function scrollToBottom() {
  const list = document.getElementById("messages");
  list.scrollTop = list.scrollHeight;
}

function renderMessage(role, content) {
  removeEmptyState();

  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  if (role === "ai") {
    const avatar = document.createElement("div");
    avatar.className = "ai-avatar";
    avatar.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M8 1l1.8 3.6L14 5.5l-3 2.9.7 4.1L8 10.5l-3.7 2 .7-4.1-3-2.9 4.2-.9z"/></svg>`;
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;

  if (role === "user") {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = markdownToHtml(content);
  }

  row.appendChild(bubble);
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

// ── Page Content Fetch ────────────────────────────────────────
async function fetchPageContent() {
  try {
    const response = await browser.runtime.sendMessage({ action: "GET_PAGE_CONTENT" });
    if (response && !response.error) {
      currentPageContext = response;
    } else {
      currentPageContext = null;
    }
  } catch {
    currentPageContext = null;
  }
}

// ── System Prompt Builder ─────────────────────────────────────
function buildSystemPrompt() {
  const base = settings.systemPrompt?.trim() ||
    "Du bist ein hilfreicher KI-Assistent.";

  if (!pageToggleEnabled || !currentPageContext) return base;

  return [
    base,
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
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) yield line.slice(6).trim();
    }
  }
}

// ── OpenAI / Local / Hyperspace Streaming ────────────────────
async function* streamOpenAI(messages) {
  const providerId = settings.provider;
  const provider = PROVIDERS[providerId];
  const url = (providerId === "local" || providerId === "hyperspace")
    ? settings.baseUrl.replace(/\/$/, "") + "/chat/completions"
    : provider.baseUrl;
  const model = (providerId === "local" || providerId === "hyperspace")
    ? settings.customModel
    : settings.model;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 2048 })
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
async function* streamAnthropic(messages) {
  const systemPrompt = buildSystemPrompt();
  const userMessages = messages.filter(m => m.role !== "system");

  const response = await fetch(PROVIDERS.anthropic.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-allow-browser": "true"
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: userMessages,
      stream: true
    })
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
async function callGemini(messages) {
  const systemPrompt = buildSystemPrompt();
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
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API ${response.status}: ${err}`);
  }

  const json = await response.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "(Keine Antwort)";
}

// ── Send Message ──────────────────────────────────────────────
async function sendMessage() {
  if (isStreaming) return;

  const input = document.getElementById("user-input");
  const text = input.value.trim();
  if (!text) return;

  isStreaming = true;
  input.value = "";
  input.style.height = "auto";
  document.getElementById("send-btn").disabled = true;

  chatHistory.push({ role: "user", content: text });
  renderMessage("user", text);

  const typingEl = document.getElementById("typing-indicator");
  typingEl.classList.remove("hidden");
  scrollToBottom();

  // Guard: no API key
  if (!settings.apiKey && settings.provider !== "local") {
    typingEl.classList.add("hidden");
    renderMessage("ai", "Bitte zuerst einen API-Key in den Einstellungen hinterlegen.");
    isStreaming = false;
    document.getElementById("send-btn").disabled = false;
    return;
  }

  const providerId = settings.provider;

  let messages;
  if (providerId === "anthropic" || providerId === "gemini") {
    messages = chatHistory.map(m => ({ role: m.role, content: m.content }));
  } else {
    messages = [
      { role: "system", content: buildSystemPrompt() },
      ...chatHistory.map(m => ({ role: m.role, content: m.content }))
    ];
  }

  let aiBubble = null;
  let fullResponse = "";

  try {
    if (providerId === "gemini") {
      fullResponse = await callGemini(messages);
      typingEl.classList.add("hidden");
      aiBubble = renderMessage("ai", fullResponse);
    } else {
      const generator = providerId === "anthropic"
        ? streamAnthropic(messages)
        : streamOpenAI(messages);

      let firstToken = true;
      for await (const token of generator) {
        if (firstToken) {
          typingEl.classList.add("hidden");
          aiBubble = renderMessage("ai", "");
          firstToken = false;
        }
        fullResponse += token;
        aiBubble.innerHTML = markdownToHtml(fullResponse);
        scrollToBottom();
      }
    }

    chatHistory.push({ role: "assistant", content: fullResponse });
    await saveHistory(chatHistory);

  } catch (err) {
    typingEl.classList.add("hidden");
    renderMessage("ai", `Fehler: ${err.message}`);
  } finally {
    isStreaming = false;
    document.getElementById("send-btn").disabled = false;
    input.focus();
  }
}

// ── Panel Navigation ──────────────────────────────────────────
function openSettings() {
  document.getElementById("chat-panel").classList.add("slide-left");
  document.getElementById("settings-panel").classList.add("active");
  loadSettingsIntoUI();
}

function closeSettings() {
  document.getElementById("settings-panel").classList.remove("active");
  document.getElementById("chat-panel").classList.remove("slide-left");
}

// ── Page Toggle ───────────────────────────────────────────────
function togglePageContext() {
  pageToggleEnabled = !pageToggleEnabled;
  const btn = document.getElementById("page-toggle-btn");
  btn.classList.toggle("active", pageToggleEnabled);
  btn.title = pageToggleEnabled ? "Seite einbeziehen (aktiv)" : "Seite einbeziehen (inaktiv)";
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
  populateModelDropdown(providerId);
}

async function clearHistory() {
  chatHistory = [];
  await saveHistory([]);
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  settings = await loadSettings();
  chatHistory = await loadHistory();

  if (chatHistory.length === 0) {
    renderEmptyState();
  } else {
    chatHistory.forEach(m =>
      renderMessage(m.role === "assistant" ? "ai" : "user", m.content)
    );
  }

  fetchPageContent();

  document.getElementById("send-btn").addEventListener("click", sendMessage);
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("back-btn").addEventListener("click", closeSettings);
  document.getElementById("save-settings-btn").addEventListener("click", saveSettingsFromUI);
  document.getElementById("clear-history-btn").addEventListener("click", clearHistory);
  document.getElementById("toggle-key-btn").addEventListener("click", toggleKeyVisibility);
  document.getElementById("page-toggle-btn").addEventListener("click", togglePageContext);
  document.getElementById("provider-select").addEventListener("change", onProviderChange);
  document.getElementById("user-input").addEventListener("keydown", onInputKeydown);
  document.getElementById("user-input").addEventListener("input", autoResizeTextarea);
}

document.addEventListener("DOMContentLoaded", init);
