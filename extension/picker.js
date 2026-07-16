// ページ上で要素をクリックして選択するピッカー。
// popup.js から chrome.scripting.executeScript で注入され、即座に選択モードを開始する。
(() => {
  if (window.__cnPickerActive) return; // 二重起動防止
  window.__cnPickerActive = true;

  const Z = 2147483646;
  let hoverEl = null;

  // ---- ハイライト用オーバーレイ ----
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed", zIndex: Z, pointerEvents: "none",
    border: "2px solid #e67e22", background: "rgba(230,126,34,.15)",
    borderRadius: "2px", display: "none",
  });
  const tip = document.createElement("div");
  Object.assign(tip.style, {
    position: "fixed", zIndex: Z, pointerEvents: "none",
    background: "#222", color: "#fff", font: "12px/1.6 monospace",
    padding: "2px 8px", borderRadius: "4px", maxWidth: "80vw",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    display: "none",
  });
  const banner = document.createElement("div");
  banner.textContent = "監視したい要素をクリックしてください(Escで中止)";
  Object.assign(banner.style, {
    position: "fixed", zIndex: Z, top: "12px", left: "50%",
    transform: "translateX(-50%)",
    background: "#e67e22", color: "#fff",
    font: "14px/1 -apple-system, sans-serif", padding: "10px 18px",
    borderRadius: "999px", boxShadow: "0 2px 12px rgba(0,0,0,.3)",
  });
  document.documentElement.append(box, tip, banner);

  // ---- CSSセレクタ生成 ----
  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, "\\$1"));
  const isStableClass = (c) => /^[A-Za-z][A-Za-z0-9_-]{1,40}$/.test(c) && !/^(is-|has-|js-)/.test(c) && !/[0-9a-f]{6,}/i.test(c);

  function selectorFor(el) {
    // 祖先を遡りながらパスを組み立て、途中で文書内一意になったら打ち切る
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && document.querySelectorAll(`#${cssEscape(cur.id)}`).length === 1) {
        parts.unshift(`#${cssEscape(cur.id)}`);
        break;
      }
      const stable = [...cur.classList].filter(isStableClass).slice(0, 2);
      if (stable.length) part += "." + stable.map(cssEscape).join(".");
      // 兄弟間で一意でなければ nth-of-type を付ける
      const parent = cur.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (sameTag.length > 1 && parent.querySelectorAll(`:scope > ${part}`).length !== 1) {
          part = `${cur.tagName.toLowerCase()}:nth-of-type(${sameTag.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      if (document.querySelectorAll(candidate).length === 1) return candidate;
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  // ---- 選択モードのイベント ----
  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === hoverEl || el === box || el === tip || el === banner) return;
    hoverEl = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: "block", left: r.left + "px", top: r.top + "px",
      width: r.width + "px", height: r.height + "px",
    });
    tip.textContent = selectorFor(el);
    Object.assign(tip.style, {
      display: "block",
      left: Math.max(4, r.left) + "px",
      top: (r.top > 30 ? r.top - 26 : r.bottom + 4) + "px",
    });
  }

  function onClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    stopPicking();
    openForm(el);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  }

  function stopPicking() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    banner.remove();
    tip.style.display = "none";
  }

  function cleanup() {
    stopPicking();
    box.remove();
    tip.remove();
    window.__cnPickerActive = false;
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);

  // ---- 登録フォーム ----
  function openForm(el) {
    const selector = selectorFor(el);
    const preview = (el.textContent || "").replace(/\s+/g, " ").trim();
    const host = document.createElement("div");
    Object.assign(host.style, { position: "fixed", zIndex: Z + 1, inset: "0" });
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); }
        .panel {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
          background: #fff; color: #222; border-radius: 12px; padding: 20px 24px;
          width: min(440px, 92vw); font: 14px/1.7 -apple-system, sans-serif;
          box-shadow: 0 8px 40px rgba(0,0,0,.35);
        }
        h2 { margin: 0 0 12px; font-size: 16px; }
        label { display: block; margin-top: 10px; font-weight: 600; font-size: 12px; }
        input, select { width: 100%; box-sizing: border-box; padding: 6px 8px; margin-top: 2px;
          border: 1px solid #ccc; border-radius: 6px; font: inherit; background: #fff; color: #222; }
        .preview { background: #f4f4f4; border-radius: 6px; padding: 6px 10px; font-size: 12px;
          max-height: 60px; overflow: auto; overflow-wrap: anywhere; margin-top: 4px; }
        code { font-size: 11px; overflow-wrap: anywhere; }
        .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
        button { padding: 8px 16px; border-radius: 8px; border: none; font: inherit; cursor: pointer; }
        .primary { background: #e67e22; color: #fff; }
        .ghost { background: #eee; }
        .msg { margin-top: 10px; font-size: 12px; }
        .err { color: #c0392b; }
      </style>
      <div class="backdrop"></div>
      <div class="panel">
        <h2>🔔 この要素を監視登録</h2>
        <div class="preview">${preview ? escapeHtml(preview.slice(0, 200)) : "(テキストなし)"}</div>
        <code>${escapeHtml(selector)}</code>
        <label>監視名 <input id="name"></label>
        <label>チェック間隔
          <select id="interval">
            <option value="5">5分</option>
            <option value="15">15分</option>
            <option value="30" selected>30分</option>
            <option value="60">1時間</option>
            <option value="180">3時間</option>
            <option value="1440">1日</option>
          </select>
        </label>
        <label>Discord Webhook URL(省略時はサーバ既定)<input id="webhook" placeholder="https://discord.com/api/webhooks/…"></label>
        <div class="msg" id="msg"></div>
        <div class="row">
          <button class="ghost" id="cancel">キャンセル</button>
          <button class="primary" id="register">登録</button>
        </div>
      </div>`;
    document.documentElement.append(host);

    const $ = (sel) => root.querySelector(sel);
    $("#name").value = `${document.title || location.hostname}: ${preview.slice(0, 30) || selector}`;

    // 保存済みのデフォルトWebhookをフォームに自動入力(使い回し)
    let savedDefaultWebhook = "";
    chrome.storage.sync.get({ defaultWebhook: "" }, ({ defaultWebhook }) => {
      savedDefaultWebhook = defaultWebhook || "";
      if (savedDefaultWebhook && !$("#webhook").value) $("#webhook").value = savedDefaultWebhook;
    });

    $("#cancel").onclick = () => { host.remove(); cleanup(); };
    $("#register").onclick = () => {
      $("#register").disabled = true;
      $("#msg").textContent = "登録中…";
      $("#msg").className = "msg";
      const webhook = $("#webhook").value.trim();
      // まだデフォルト未設定なら、入力されたURLを既定値として保存(一度入れれば以後使い回し)
      if (webhook && !savedDefaultWebhook) chrome.storage.sync.set({ defaultWebhook: webhook });
      chrome.runtime.sendMessage(
        {
          type: "cn-register",
          payload: {
            name: $("#name").value,
            url: location.href,
            selector,
            interval_minutes: Number($("#interval").value),
            webhook_url: webhook,
          },
        },
        (res) => {
          if (res?.ok) {
            $("#msg").textContent = "✅ 登録しました。初回チェックを実行中です。";
            setTimeout(() => { host.remove(); cleanup(); }, 1500);
          } else {
            $("#register").disabled = false;
            $("#msg").className = "msg err";
            $("#msg").textContent = "❌ " + (res?.error || chrome.runtime.lastError?.message || "不明なエラー");
          }
        }
      );
    };
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
