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
  for (const item of MENU_ITEMS) {
    browser.contextMenus.create({
      id: item.id,
      title: item.title,
      contexts: ["selection"]
    });
  }
});

browser.contextMenus.onClicked.addListener(async (info) => {
  const buildPrompt = PROMPTS[info.menuItemId];
  if (!buildPrompt || !info.selectionText) return;
  const prompt = buildPrompt(info.selectionText.trim());
  await browser.storage.local.set({ contextMenuPrompt: prompt });
  try {
    await browser.runtime.sendMessage({ type: "CONTEXT_MENU_TEXT", prompt });
  } catch {
    // Popup not open — it will read contextMenuPrompt on next init()
  }
});
