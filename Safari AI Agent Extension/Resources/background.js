const MENU_ITEMS = [
  { id: "ai-explain",   title: "Mit AI erklären" },
  { id: "ai-translate", title: "Mit AI übersetzen" },
  { id: "ai-summarize", title: "Mit AI zusammenfassen" }
];

const PROMPTS = {
  "ai-explain":   (text) => `Erkläre mir bitte Folgendes kurz und verständlich:\n\n"${text}"`,
  "ai-translate": (text) => `Übersetze den folgenden Text auf Deutsch:\n\n"${text}"`,
  "ai-summarize": (text) => `Fasse den folgenden Text in 2-3 Sätzen zusammen:\n\n"${text}"`
};

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.removeAll().then(() => {
    for (const item of MENU_ITEMS) {
      browser.contextMenus.create({
        id: item.id,
        title: item.title,
        contexts: ["selection"]
      });
    }
  });
});

browser.contextMenus.onClicked.addListener(async (info) => {
  const buildPrompt = PROMPTS[info.menuItemId];
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
const AGENT_MAX_ITERATIONS = 30;
const AGENT_ACTION_TIMEOUT_MS = 60000;

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "AGENT_START") {
    if (agentRunning) { sendResponse({ ok: false, error: "already running" }); return true; }
    agentAbort = false;
    agentRunning = true;
    runAgentLoop(message.task, message.tabId, message.providerId, message.model, message.apiKey, message.baseUrl)
      .catch(e => notifyPopup({ type: "AGENT_LOG", status: "error", text: `Fehler: ${e.message}` }))
      .finally(() => {
        agentRunning = false;
        notifyPopup({ type: "AGENT_DONE" });
      });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "AGENT_STOP") {
    agentAbort = true;
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

function notifyPopup(msg) {
  browser.runtime.sendMessage(msg).catch(() => {});
}

async function runAgentLoop(task, tabId, providerId, model, apiKey, baseUrl) {
  notifyPopup({ type: "AGENT_LOG", status: "thinking", text: "Analysiere Seite…" });

  for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
    if (agentAbort) {
      notifyPopup({ type: "AGENT_LOG", status: "info", text: "Abgebrochen." });
      return;
    }

    // 1. Screenshot
    let screenshotDataUrl = null;
    try {
      screenshotDataUrl = await browser.tabs.captureVisibleTab(null, { format: "jpeg", quality: 70 });
    } catch (e) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: `Screenshot fehlgeschlagen: ${e.message}` });
    }

    // 2. DOM
    let domElements = [];
    let pageUrl = "";
    try {
      const domResult = await browser.tabs.sendMessage(tabId, { action: "AGENT_DOM" });
      domElements = domResult?.elements ?? [];
      pageUrl = domResult?.url ?? "";
    } catch (e) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: `DOM-Extraktion fehlgeschlagen: ${e.message}` });
    }

    // 3. AI-Call
    const aiResponse = await callAgentAI({
      task, domElements, pageUrl, iteration: i,
      screenshotDataUrl, providerId, model, apiKey, baseUrl
    });

    if (!aiResponse) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: "AI-Antwort konnte nicht gelesen werden." });
      return;
    }

    const { action, selector, value, direction, amount, url, ms, summary } = aiResponse;
    const logText = buildLogText(aiResponse);

    // 4. Kritische Aktion? → Bestätigung anfordern
    if (action === "submit" || (action === "click" && isSubmitElement(selector, domElements))) {
      const confirmed = await requestConfirmation(logText);
      if (agentAbort) {
        notifyPopup({ type: "AGENT_LOG", status: "info", text: "Abgebrochen." });
        return;
      }
      if (!confirmed) {
        notifyPopup({ type: "AGENT_LOG", status: "info", text: "Aktion abgebrochen (nicht bestätigt)." });
        continue;
      }
    }

    notifyPopup({ type: "AGENT_LOG", status: "running", text: logText });

    if (action === "done") {
      notifyPopup({ type: "AGENT_LOG", status: "success", text: `Erledigt: ${summary || "Aufgabe abgeschlossen"}` });
      return;
    }

    // 5. Highlight anzeigen
    if (selector) {
      await browser.tabs.sendMessage(tabId, { action: "AGENT_HIGHLIGHT", selector, actionType: action }).catch(() => {});
    }

    // 6. Aktion ausführen
    const actionMsg = { action, selector, value, direction, amount, url, ms };
    let actionTimeoutId;
    const actionResult = await Promise.race([
      browser.tabs.sendMessage(tabId, { action: "AGENT_ACTION", ...actionMsg })
        .finally(() => clearTimeout(actionTimeoutId)),
      new Promise((_, reject) => {
        actionTimeoutId = setTimeout(() => reject(new Error("timeout")), AGENT_ACTION_TIMEOUT_MS);
      })
    ]).catch(e => ({ ok: false, error: e.message }));

    if (!actionResult?.ok) {
      notifyPopup({ type: "AGENT_LOG", status: "error", text: `Fehler bei "${action}": ${actionResult?.error ?? "unbekannt"}` });
    }

    // Kurz warten damit Seite reagieren kann
    await new Promise(r => setTimeout(r, 600));
  }

  notifyPopup({ type: "AGENT_LOG", status: "error", text: `Maximale Iterationen (${AGENT_MAX_ITERATIONS}) erreicht.` });
}

function buildLogText(aiResponse) {
  const { action, selector, value, direction, summary } = aiResponse;
  if (action === "click") return `Klicke auf ${selector}`;
  if (action === "type") return `Tippe "${value}" in ${selector}`;
  if (action === "scroll") return `Scrolle ${direction}`;
  if (action === "select") return `Wähle "${value}" in ${selector}`;
  if (action === "navigate") return `Navigiere zu ${aiResponse.url}`;
  if (action === "wait") return `Warte ${aiResponse.ms}ms…`;
  if (action === "done") return `Erledigt: ${summary || ""}`;
  return action;
}

function isSubmitElement(selector, domElements) {
  if (!selector) return false;
  const el = domElements.find(e => e.selector === selector);
  return el?.type === "submit" || (el?.tag === "button" && /submit|senden|send|abschicken/i.test(el.label));
}

async function requestConfirmation(actionText) {
  return new Promise(resolve => {
    const handler = (msg) => {
      if (msg.type === "AGENT_CONFIRM_RESPONSE") {
        browser.runtime.onMessage.removeListener(handler);
        resolve(msg.confirmed);
      }
    };
    browser.runtime.onMessage.addListener(handler);
    notifyPopup({ type: "AGENT_CONFIRM_REQUEST", actionText });
    setTimeout(() => { browser.runtime.onMessage.removeListener(handler); resolve(false); }, 30000);
  });
}

async function callAgentAI({ task, domElements, pageUrl, iteration, screenshotDataUrl, providerId, model, apiKey, baseUrl }) {
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (!['https:', 'http:'].includes(u.protocol)) {
        throw new Error("disallowed protocol in baseUrl");
      }
    } catch (e) {
      throw new Error(`Invalid baseUrl: ${e.message}`);
    }
  }

  const domSummary = domElements.slice(0, 80).map(e =>
    `[${e.index}] ${e.tag}${e.type ? `[type=${e.type}]` : ""}${e.id ? `#${e.id}` : ""}${e.label ? ` "${e.label}"` : ""} → ${e.selector}`
  ).join("\n");

  const systemPrompt = `Du bist ein Web-Automatisierungs-Agent. Du erhältst einen Screenshot und eine Liste interaktiver Elemente der aktuellen Seite sowie eine Aufgabe.
Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Text drumherum) mit genau einem der folgenden Formate:
- {"action":"click","selector":"<css-selektor>","reason":"<warum>"}
- {"action":"type","selector":"<css-selektor>","value":"<text>","reason":"<warum>"}
- {"action":"scroll","direction":"down"|"up","amount":300,"reason":"<warum>"}
- {"action":"select","selector":"<css-selektor>","value":"<option-value>","reason":"<warum>"}
- {"action":"navigate","url":"<url>","reason":"<warum>"}
- {"action":"wait","ms":1000,"reason":"<warum>"}
- {"action":"done","summary":"<was wurde erreicht>"}
Verwende nur Selektoren aus der DOM-Liste. Wenn du unsicher bist, wähle "scroll" oder "wait".`;

  const userContent = [];

  if (screenshotDataUrl) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: screenshotDataUrl.replace("data:image/jpeg;base64,", "") }
    });
  }

  userContent.push({
    type: "text",
    text: `Aufgabe: ${task}\nIteration: ${iteration + 1}/${AGENT_MAX_ITERATIONS}\nURL: ${pageUrl}\n\nInteraktive Elemente:\n${domSummary || "(keine gefunden)"}`
  });

  try {
    if (providerId === "anthropic") {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }]
        })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const text = data?.content?.[0]?.text ?? "";
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      return JSON.parse(stripped);
    } else {
      // OpenAI-compatible (openai, hyperspace, local)
      const messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: screenshotDataUrl ? [
            { type: "image_url", image_url: { url: screenshotDataUrl } },
            { type: "text", text: `Aufgabe: ${task}\nIteration: ${iteration + 1}/${AGENT_MAX_ITERATIONS}\nURL: ${pageUrl}\n\nInteraktive Elemente:\n${domSummary || "(keine gefunden)"}` }
          ] : `Aufgabe: ${task}\nIteration: ${iteration + 1}/${AGENT_MAX_ITERATIONS}\nURL: ${pageUrl}\n\nInteraktive Elemente:\n${domSummary || "(keine gefunden)"}`
        }
      ];
      const endpoint = baseUrl
        ? `${baseUrl.replace(/\/$/, "")}/chat/completions`
        : "https://api.openai.com/v1/chat/completions";
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model, max_tokens: 1024, messages })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content ?? "";
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      return JSON.parse(stripped);
    }
  } catch (e) {
    return null;
  }
}
