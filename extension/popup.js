const DEFAULT_API_BASE = "http://localhost:8787";
const apiBaseInput = document.getElementById("apiBase");
const defaultWebhookInput = document.getElementById("defaultWebhook");
const dashboard = document.getElementById("dashboard");
const msg = document.getElementById("msg");

chrome.storage.sync.get({ apiBase: DEFAULT_API_BASE, defaultWebhook: "" }, ({ apiBase, defaultWebhook }) => {
  apiBaseInput.value = apiBase;
  defaultWebhookInput.value = defaultWebhook;
  dashboard.href = apiBase;
});

apiBaseInput.addEventListener("change", () => {
  const apiBase = apiBaseInput.value.trim().replace(/\/$/, "") || DEFAULT_API_BASE;
  apiBaseInput.value = apiBase;
  dashboard.href = apiBase;
  chrome.storage.sync.set({ apiBase });
});

defaultWebhookInput.addEventListener("change", () => {
  chrome.storage.sync.set({ defaultWebhook: defaultWebhookInput.value.trim() });
});

async function startPicker(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) {
    msg.textContent = "このページでは使えません(http/httpsのページで開いてください)";
    return;
  }
  try {
    // 注入前にモードをページ側グローバルへ渡す
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (m) => { window.__cnPickerMode = m; },
      args: [mode],
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker.js"] });
    window.close();
  } catch (e) {
    msg.textContent = "注入失敗: " + e.message;
  }
}

document.getElementById("pick").addEventListener("click", () => startPicker("value"));
document.getElementById("pickKeyword").addEventListener("click", () => startPicker("keyword"));
