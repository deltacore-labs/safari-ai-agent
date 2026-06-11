browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "EXTRACT_DOM") {
    const rawText = document.body?.innerText ?? "";
    const truncated = rawText.length > 50000
      ? rawText.slice(0, 50000) + "\n...[truncated]"
      : rawText;
    sendResponse({ text: truncated, title: document.title, url: window.location.href });
    return true;
  }

  if (message.action === "AGENT_DOM") {
    const elements = [];
    const selectors = "input, button, a, select, textarea, [role='button'], [role='link'], [role='checkbox'], [role='menuitem']";
    document.querySelectorAll(selectors).forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const label = el.getAttribute("aria-label")
        || el.getAttribute("placeholder")
        || el.getAttribute("title")
        || el.textContent?.trim().slice(0, 60)
        || "";
      elements.push({
        index: i,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || "",
        id: el.id || "",
        name: el.getAttribute("name") || "",
        label,
        selector: buildSelector(el)
      });
    });
    sendResponse({ elements, url: window.location.href, title: document.title });
    return true;
  }

  if (message.action === "AGENT_HIGHLIGHT") {
    const { selector, actionType } = message;
    const el = document.querySelector(selector);
    if (!el) { sendResponse({ ok: false }); return true; }
    const color = actionType === "type" ? "#f97316" : "#3b82f6";
    const label = actionType === "type" ? "Tippe…" : actionType === "click" ? "Klicke…" : actionType;
    showHighlight(el, color, label);
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === "AGENT_ACTION") {
    const { action, selector, value, direction, amount, url, ms } = message;
    (async () => {
      try {
        if (action === "click") {
          const el = document.querySelector(selector);
          if (!el) { sendResponse({ ok: false, error: `selector not found: ${selector}` }); return; }
          el.focus();
          el.click();
          sendResponse({ ok: true });
        } else if (action === "type") {
          const el = document.querySelector(selector);
          if (!el) { sendResponse({ ok: false, error: `selector not found: ${selector}` }); return; }
          el.focus();
          el.value = "";
          for (const char of String(value)) {
            el.value += char;
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
          el.dispatchEvent(new Event("change", { bubbles: true }));
          sendResponse({ ok: true });
        } else if (action === "scroll") {
          const dy = direction === "up" ? -(amount || 300) : (amount || 300);
          window.scrollBy({ top: dy, behavior: "smooth" });
          sendResponse({ ok: true });
        } else if (action === "select") {
          const el = document.querySelector(selector);
          if (!el) { sendResponse({ ok: false, error: `selector not found: ${selector}` }); return; }
          el.value = value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          sendResponse({ ok: true });
        } else if (action === "navigate") {
          const currentOrigin = window.location.origin;
          const targetUrl = new URL(url, window.location.href);
          if (targetUrl.origin !== currentOrigin) {
            sendResponse({ ok: false, error: "cross-origin navigation blocked" });
            return;
          }
          window.location.href = targetUrl.href;
          sendResponse({ ok: true });
        } else if (action === "wait") {
          await new Promise(r => setTimeout(r, Math.min(ms || 1000, 5000)));
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: `unknown action: ${action}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  return false;
});

function buildSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.getAttribute("name")) return `${el.tagName.toLowerCase()}[name="${el.getAttribute("name")}"]`;
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length === 1) {
      const parentSel = buildSelector(parent);
      return `${parentSel} > ${el.tagName.toLowerCase()}`;
    }
    const idx = siblings.indexOf(el);
    const parentSel = buildSelector(parent);
    return `${parentSel} > ${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
  }
  return el.tagName.toLowerCase();
}

function showHighlight(el, color, label) {
  const existing = document.getElementById("__agent-highlight__");
  if (existing) existing.remove();

  const rect = el.getBoundingClientRect();
  const div = document.createElement("div");
  div.id = "__agent-highlight__";
  div.style.cssText = `
    position: fixed;
    top: ${rect.top - 2}px;
    left: ${rect.left - 2}px;
    width: ${rect.width + 4}px;
    height: ${rect.height + 4}px;
    border: 2px solid ${color};
    border-radius: 4px;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: 0 0 0 3px ${color}33;
    transition: opacity 0.3s;
  `;

  const badge = document.createElement("span");
  badge.textContent = label;
  badge.style.cssText = `
    position: absolute;
    top: -22px;
    left: 0;
    background: ${color};
    color: white;
    font-size: 11px;
    font-family: sans-serif;
    padding: 2px 6px;
    border-radius: 3px;
    white-space: nowrap;
  `;
  div.appendChild(badge);
  document.body.appendChild(div);

  setTimeout(() => {
    div.style.opacity = "0";
    setTimeout(() => div.remove(), 300);
  }, 1200);
}
