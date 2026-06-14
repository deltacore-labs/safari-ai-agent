import { t, setLanguage } from "./i18n.js";

async function loadLang() {
  const result = await browser.storage.local.get(["settings"]);
  const lang = result?.settings?.language ?? "de";
  setLanguage(lang);
}

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
  } catch {
    // Popup not open — it will read contextMenuPrompt on next init()
  }
});

// ── Agent Loop ────────────────────────────────────────────────
let agentRunning = false;
let agentAbort = false;
let agentAbortController = null;
let pendingConfirmResolver = null;
const AGENT_MAX_ITERATIONS = 30;
const AGENT_ACTION_TIMEOUT_MS = 60000;

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "AGENT_START") {
    if (agentRunning) { sendResponse({ ok: false, error: "already running" }); return true; }
    agentAbort = false;
    agentAbortController = new AbortController();
    agentRunning = true;
    runAgentLoop(message.task, message.tabId, message.providerId, message.model, message.apiKey, message.baseUrl)
      .catch(e => notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_error_prefix", e.message) }))
      .finally(() => {
        agentRunning = false;
        agentAbortController = null;
        notifyPopup({ type: "AGENT_DONE" });
      });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "AGENT_STOP") {
    agentAbort = true;
    // Abort any in-flight fetch immediately so the loop's iteration check
    // doesn't have to wait for the model to finish responding.
    if (agentAbortController) {
      try { agentAbortController.abort(); } catch { /* already aborted */ }
    }
    // Resolve any pending confirmation as denied so the loop can advance.
    if (pendingConfirmResolver) {
      pendingConfirmResolver(false);
      pendingConfirmResolver = null;
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "LANGUAGE_CHANGED") {
    setLanguage(message.language ?? "de");
    for (const item of getMenuItems()) {
      browser.contextMenus.update(item.id, { title: item.title }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

function notifyPopup(msg) {
  browser.runtime.sendMessage(msg).catch(() => {});
}

async function runAgentLoop(task, tabId, providerId, model, apiKey, baseUrl) {
  await loadLang();
  notifyPopup({ type: "AGENT_LOG", status: "thinking", text: t("agent_analyzing") });

  for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
    if (agentAbort) {
      notifyPopup({ type: "AGENT_LOG", status: "info", text: t("agent_aborted") });
      return;
    }

    // 1. Screenshot
    let screenshotDataUrl = null;
    try {
      const tabInfo = await browser.tabs.get(tabId);
      screenshotDataUrl = await browser.tabs.captureVisibleTab(tabInfo.windowId, { format: "jpeg", quality: 70 });
    } catch (e) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_screenshot_fail", e.message) });
    }

    // 2. DOM
    let domElements = [];
    let pageUrl = "";
    try {
      const domResult = await browser.tabs.sendMessage(tabId, { action: "AGENT_DOM" });
      domElements = domResult?.elements ?? [];
      pageUrl = domResult?.url ?? "";
    } catch (e) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_dom_fail", e.message) });
    }

    // 3. AI-Call
    let aiResponse;
    try {
      aiResponse = await callAgentAI({
        task, domElements, pageUrl, iteration: i,
        screenshotDataUrl, providerId, model, apiKey, baseUrl
      });
    } catch (e) {
      if (e?.name === "AbortError") {
        notifyPopup({ type: "AGENT_LOG", status: "info", text: t("agent_aborted") });
        return;
      }
      notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_ai_fail", e.message) });
      return;
    }

    if (!aiResponse) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_no_response") });
      return;
    }

    const { action, selector, value, direction, amount, url, ms, summary } = aiResponse;
    const logText = buildLogText(aiResponse);

    // 4. Kritische Aktion? → Bestätigung anfordern
    if (action === "click" && isSubmitElement(selector, domElements)) {
      const confirmed = await requestConfirmation(logText);
      if (agentAbort) {
        notifyPopup({ type: "AGENT_LOG", status: "info", text: t("agent_aborted") });
        return;
      }
      if (!confirmed) {
        notifyPopup({ type: "AGENT_LOG", status: "info", text: t("agent_not_confirmed") });
        continue;
      }
    }

    notifyPopup({ type: "AGENT_LOG", status: "running", text: logText });

    if (action === "done") {
      notifyPopup({ type: "AGENT_LOG", status: "success", text: t("agent_done", summary || t("agent_done_default")) });
      return;
    }

    // 5. Highlight anzeigen
    if (selector) {
      await browser.tabs.sendMessage(tabId, { action: "AGENT_HIGHLIGHT", selector, actionType: action }).catch(() => {});
    }

    // 6. Aktion ausführen
    const actionMsg = { cmd: action, selector, value, direction, amount, url, ms };
    let actionTimeoutId;
    const actionResult = await Promise.race([
      browser.tabs.sendMessage(tabId, { action: "AGENT_ACTION", ...actionMsg })
        .finally(() => clearTimeout(actionTimeoutId)),
      new Promise((_, reject) => {
        actionTimeoutId = setTimeout(() => reject(new Error("timeout")), AGENT_ACTION_TIMEOUT_MS);
      })
    ]).catch(e => ({ ok: false, error: e.message }));

    if (!actionResult?.ok) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_action_error", action, actionResult?.error ?? t("agent_action_unknown")) });
    }

    // Kurz warten damit Seite reagieren kann
    await new Promise(r => setTimeout(r, 600));
  }

  notifyPopup({ type: "AGENT_LOG", status: "error", text: t("agent_max_iter", AGENT_MAX_ITERATIONS) });
}

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

function isSubmitElement(selector, domElements) {
  if (!selector) return false;
  const el = domElements.find(e => e.selector === selector);
  return el?.type === "submit" || (el?.tag === "button" && /submit|senden|send|abschicken/i.test(el.label));
}

async function requestConfirmation(actionText) {
  return new Promise(resolve => {
    let timeoutId;
    const handler = (msg) => {
      if (msg.type === "AGENT_CONFIRM_RESPONSE") {
        clearTimeout(timeoutId);
        browser.runtime.onMessage.removeListener(handler);
        pendingConfirmResolver = null;
        resolve(msg.confirmed);
      }
    };
    // Expose resolver to AGENT_STOP so a stop-click during confirmation
    // unblocks the loop instantly instead of waiting up to 30s.
    pendingConfirmResolver = (val) => {
      clearTimeout(timeoutId);
      browser.runtime.onMessage.removeListener(handler);
      resolve(val);
    };
    browser.runtime.onMessage.addListener(handler);
    notifyPopup({ type: "AGENT_CONFIRM_REQUEST", actionText });
    timeoutId = setTimeout(() => {
      browser.runtime.onMessage.removeListener(handler);
      if (pendingConfirmResolver) {
        pendingConfirmResolver = null;
        resolve(false);
      }
    }, 30000);
  });
}

async function callAgentAI({ task, domElements, pageUrl, iteration, screenshotDataUrl, providerId, model, apiKey, baseUrl }) {
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      // Only https is allowed broadly. Plain http is permitted only for
      // localhost-style hosts so a misconfigured remote URL can't leak the
      // API key + screenshot + DOM in plaintext.
      const isLocalhost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
      if (u.protocol === 'https:') {
        // ok
      } else if (u.protocol === 'http:' && isLocalhost) {
        // ok
      } else {
        throw new Error("disallowed protocol in baseUrl (https or http://localhost only)");
      }
    } catch (e) {
      throw new Error(`Invalid baseUrl: ${e.message}`);
    }
  }

  const domSummary = domElements.slice(0, 80).map(e =>
    `[${e.index}] ${e.tag}${e.type ? `[type=${e.type}]` : ""}${e.id ? `#${e.id}` : ""}${e.label ? ` "${e.label}"` : ""} → ${e.selector}`
  ).join("\n");

  const systemPrompt = t("agent_sys_prompt");

  const userContent = [];

  if (screenshotDataUrl) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: screenshotDataUrl.replace("data:image/jpeg;base64,", "") }
    });
  }

  userContent.push({
    type: "text",
    text: t("agent_task_label", task, iteration + 1, AGENT_MAX_ITERATIONS, pageUrl, domSummary || t("agent_no_elements"))
  });

  const signal = agentAbortController?.signal;

  if (providerId === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-allow-browser": "true",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }]
      }),
      signal
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const text = data?.content?.[0]?.text ?? "";
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try {
      return JSON.parse(stripped);
    } catch (e) {
      throw new Error(t("agent_json_parse_error", stripped.slice(0, 80) + "…"));
    }
  } else {
    // OpenAI-compatible (openai, hyperspace, local)
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: screenshotDataUrl ? [
          { type: "image_url", image_url: { url: screenshotDataUrl } },
          { type: "text", text: t("agent_task_label", task, iteration + 1, AGENT_MAX_ITERATIONS, pageUrl, domSummary || t("agent_no_elements")) }
        ] : t("agent_task_label", task, iteration + 1, AGENT_MAX_ITERATIONS, pageUrl, domSummary || t("agent_no_elements"))
      }
    ];
    const endpoint = baseUrl
      ? `${baseUrl.replace(/\/$/, "")}/chat/completions`
      : "https://api.openai.com/v1/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, max_tokens: 2048, messages }),
      signal
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try {
      return JSON.parse(stripped);
    } catch (e) {
      throw new Error(t("agent_json_parse_error", stripped.slice(0, 80) + "…"));
    }
  }
}
