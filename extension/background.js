const DEFAULT_API_BASE = "http://localhost:8787";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "cn-register") return;
  (async () => {
    const { apiBase } = await chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE });
    try {
      const res = await fetch(`${apiBase}/api/watches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        sendResponse({ ok: false, error: body.error || `HTTP ${res.status}` });
        return;
      }
      sendResponse({ ok: true, watch: await res.json() });
    } catch (e) {
      sendResponse({ ok: false, error: `サーバに接続できません (${apiBase}): ${e.message}` });
    }
  })();
  return true; // 非同期でsendResponseする
});
