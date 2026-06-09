browser.runtime.onMessage.addListener((message) => {
  if (message.action !== "GET_PAGE_CONTENT") return;

  return browser.tabs.query({ active: true, currentWindow: true })
    .then((tabs) => {
      if (!tabs || tabs.length === 0) {
        return { error: "No active tab found" };
      }
      return browser.tabs.sendMessage(tabs[0].id, { action: "EXTRACT_DOM" })
        .catch(() => ({ error: "Cannot access this page" }));
    });
});
