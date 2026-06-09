browser.runtime.onMessage.addListener((message) => {
  if (message.action !== "EXTRACT_DOM") return;

  const rawText = document.body?.innerText ?? "";
  const truncated = rawText.length > 50000
    ? rawText.slice(0, 50000) + "\n...[truncated]"
    : rawText;

  return Promise.resolve({
    text: truncated,
    title: document.title,
    url: window.location.href
  });
});
