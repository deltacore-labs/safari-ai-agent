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
let isStreaming = false;
let currentPageContext = null;
let pageToggleEnabled = true;
let lastDisplayedModel = null;

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
  const history = Array.isArray(result.chatHistory) ? result.chatHistory : [];
  // Truncate each message content to 10k chars to prevent runaway storage
  return history.map(m => ({
    ...m,
    content: m.content.length > 10000 ? m.content.slice(0, 10000) + "…" : m.content
  }));
}

async function saveHistory(h) {
  const MAX_BYTES = 512 * 1024; // 512KB limit for chat history
  let trimmed = h.length > 100 ? h.slice(h.length - 100) : [...h];

  // Trim oldest messages until serialized size fits
  while (trimmed.length > 0) {
    const bytes = new TextEncoder().encode(JSON.stringify(trimmed)).length;
    if (bytes <= MAX_BYTES) break;
    trimmed = trimmed.slice(Math.ceil(trimmed.length * 0.2)); // drop oldest 20%
  }

  try {
    await browser.storage.local.set({ chatHistory: trimmed });
  } catch {
    // Storage still full even after trimming — save only last 2 exchanges (4 messages)
    const minimal = trimmed.slice(-4);
    try {
      await browser.storage.local.set({ chatHistory: minimal });
    } catch {
      // Give up persisting — keep in memory only
    }
  }
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
  const defaultBaseUrl = PROVIDERS[settings.provider]?.baseUrl ?? "";
  document.getElementById("base-url-input").value = settings.baseUrl || defaultBaseUrl;
  document.getElementById("system-prompt-input").value = settings.systemPrompt;
  updateBaseUrlVisibility(settings.provider);
  populateModelDropdown(settings.provider);  // async, fire-and-forget — handles model restore internally

  const isCustom = settings.provider === "local";
  if (isCustom) {
    document.getElementById("model-custom-input").value = settings.customModel;
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
  };

  settings = newSettings;
  await saveSettings(settings);
  lastDisplayedModel = null; // Force model tag to show on next message

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
function updatePageToggleUI() {
  const btn = document.getElementById("page-toggle-btn");
  if (!btn) return;
  const loaded = currentPageContext !== null;
  const active = pageToggleEnabled && loaded;
  btn.classList.toggle("active", active);
  if (!pageToggleEnabled) {
    btn.title = "Seite einbeziehen (deaktiviert)";
  } else if (loaded) {
    btn.title = `Seite einbeziehen: ${currentPageContext.title || currentPageContext.url}`;
  } else {
    btn.title = "Seite wird geladen…";
  }
}

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
  updatePageToggleUI();
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
  const model = providerId === "local"
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

  // Show model tag if model changed since last message
  const currentModel = settings.model || settings.customModel || "?";
  if (currentModel !== lastDisplayedModel) {
    const providerName = PROVIDERS[settings.provider]?.name ?? settings.provider;
    // Strip vendor prefixes like "anthropic--" or "openai/" for readability
    const displayModel = currentModel.replace(/^[a-z]+--/i, "").replace(/^[a-z]+\//i, "");
    renderModelTag(`${providerName} · ${displayModel}`);
    lastDisplayedModel = currentModel;
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
        scrollToBottomIfNear();
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
async function togglePageContext() {
  if (!currentPageContext) {
    // No content yet — try to fetch now
    await fetchPageContent();
    if (currentPageContext) pageToggleEnabled = true;
  } else {
    pageToggleEnabled = !pageToggleEnabled;
  }
  updatePageToggleUI();
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
  if (!baseUrlInput.value.trim()) {
    baseUrlInput.value = PROVIDERS[providerId]?.baseUrl ?? "";
  }
  populateModelDropdown(providerId);
}

async function clearHistory() {
  chatHistory = [];
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
  try { await browser.storage.local.remove("chatHistory"); } catch { /* ignore */ }
}

async function startNewConversation() {
  // Reset UI first — don't wait for storage
  chatHistory = [];
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
  currentPageContext = null;
  updatePageToggleUI();
  fetchPageContent();
  // Clear storage — best effort
  try { await browser.storage.local.remove("chatHistory"); } catch { /* ignore */ }
}

function refreshModels() {
  const providerId = document.getElementById("provider-select").value;
  populateModelDropdown(providerId);
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

  updatePageToggleUI();
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
  document.getElementById("new-chat-btn").addEventListener("click", startNewConversation);
  document.getElementById("refresh-models-btn").addEventListener("click", refreshModels);

  const debouncedRefetchModels = debounce(() => {
    const providerId = document.getElementById("provider-select").value;
    populateModelDropdown(providerId);
  }, 300);

  document.getElementById("base-url-input").addEventListener("input", debouncedRefetchModels);
  document.getElementById("api-key-input").addEventListener("input", debouncedRefetchModels);
}

document.addEventListener("DOMContentLoaded", init);
