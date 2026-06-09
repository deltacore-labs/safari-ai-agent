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

async function loadHistory() {
  const result = await browser.storage.local.get(["chatHistory"]);
  const history = Array.isArray(result.chatHistory) ? result.chatHistory : [];
  // Coerce content to string + cap at 10k chars. Old/corrupt entries
  // (undefined, numbers, objects from earlier schemas) become empty strings
  // rather than throwing on .length / .slice.
  return history
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .map(m => {
      const content = typeof m.content === "string" ? m.content : String(m.content ?? "");
      return {
        ...m,
        content: content.length > 10000 ? content.slice(0, 10000) + "…" : content
      };
    });
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
  populateModelDropdown(settings.provider);  // async, fire-and-forget — handles model + custom input restore internally
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
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, href) => {
      const safe = sanitizeUrl(href);
      if (!safe) return label;
      const safeAttr = safe.replace(/"/g, "&quot;");
      return `<a href="${safeAttr}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
  );

  // Unordered lists — collapse consecutive `- item` lines into a <ul>
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
      if (trimmed.startsWith("<pre") || trimmed.startsWith("<ul")) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
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
  notice.textContent = `Seitenkontext: ${label}`;
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
    if (data && data.text) {
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
const UNCERTAINTY_RE = /nach meinem (trainingsstand|wissensstand)|ich wei[sß] (es )?nicht|kann ich nicht bestätigen|nicht (ganz |völlig )?sicher|mein wissen reicht bis|ich habe keinen zugriff|kann ich nicht mit sicherheit|as of my (knowledge|training)|i (don't|do not|cannot|can't) (know|confirm|access|verify)|my (knowledge|training) (cutoff|ends|is limited)|i'?m not (sure|certain)|i have no (access|information)/i;

function uncertaintyCheck(text) {
  return UNCERTAINTY_RE.test(text);
}

// ── System Prompt Builder ─────────────────────────────────────
function buildSystemPrompt(includePageContext = false) {
  const base = settings.systemPrompt?.trim() ||
    "Du bist ein hilfreicher KI-Assistent.";

  const now = new Date();
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const withDate = `${base}\n\nAktuelles Datum: ${dateStr}.`;

  if (!includePageContext || !currentPageContext || currentPageContext._debugError) return withDate;

  return [
    withDate,
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
async function* streamOpenAI(messages) {
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

async function* streamAnthropic(messages, includeCtx = false) {
  const systemPrompt = buildSystemPrompt(includeCtx);
  const userMessages = normalizeAnthropicMessages(messages);

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
async function callGemini(messages, includeCtx = false) {
  const systemPrompt = buildSystemPrompt(includeCtx);
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
    typingEl.setAttribute("aria-hidden", "true");
    renderMessage("ai", "Bitte zuerst einen API-Key in den Einstellungen hinterlegen.");
    isStreaming = false;
    document.getElementById("send-btn").disabled = input.value.trim().length === 0;
    return;
  }

  const providerId = settings.provider;

  let aiBubble = null;
  let fullResponse = "";

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
      fullResponse = await callGemini(messages, includeCtx);
      typingEl.classList.add("hidden");
      aiBubble = renderMessage("ai", fullResponse);
    } else {
      const generator = providerId === "anthropic"
        ? streamAnthropic(messages, includeCtx)
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
        aiBubble._rawText = fullResponse;
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
    // Re-enable only if there's something to send — input is empty after a
    // successful send, so leaving it disabled until the user types is correct.
    document.getElementById("send-btn").disabled = input.value.trim().length === 0;
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
  try { await browser.storage.local.remove("chatHistory"); } catch { /* ignore */ }
}

async function startNewConversation() {
  // Reset UI first — don't wait for storage
  chatHistory = [];
  lastDisplayedModel = null;
  document.getElementById("messages").innerHTML = "";
  renderEmptyState();
  currentPageContext = null;
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
  const stored = await browser.storage.local.get(["pageContextMode"]);
  const validModes = ["auto", "on", "off"];
  pageContextMode = validModes.includes(stored.pageContextMode) ? stored.pageContextMode : "auto";
  updatePageCtrlUI();
  chatHistory = await loadHistory();
  applyTheme(settings.provider, settings.model);

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
  document.getElementById("provider-select").addEventListener("change", onProviderChange);
  document.getElementById("user-input").addEventListener("keydown", onInputKeydown);
  document.getElementById("user-input").addEventListener("input", autoResizeTextarea);
  document.getElementById("new-chat-btn").addEventListener("click", startNewConversation);
  document.getElementById("refresh-models-btn").addEventListener("click", refreshModels);

  document.getElementById("page-ctx-control").addEventListener("click", async (e) => {
    const btn = e.target.closest(".page-ctx-btn");
    if (!btn) return;
    const newMode = btn.dataset.mode;
    if (newMode === pageContextMode) return;
    pageContextMode = newMode;
    updatePageCtrlUI();
    await browser.storage.local.set({ pageContextMode });

    const MODE_LABELS = { auto: "Auto", on: "Seite", off: "Aus" };
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
