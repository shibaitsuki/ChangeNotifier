// ページ上で要素をクリックして選択するピッカー。
// popup.js から chrome.scripting.executeScript で注入される。
// window.__cnPickerMode で 'value'(要素の値監視) と 'keyword'(キーワード出現監視) を切替える。
(() => {
  if (window.__cnPickerActive) return; // 二重起動防止
  window.__cnPickerActive = true;

  const MODE = window.__cnPickerMode === "keyword" ? "keyword" : "value";
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
  Object.assign(banner.style, {
    position: "fixed", zIndex: Z, top: "12px", left: "50%",
    transform: "translateX(-50%)", display: "flex", gap: "10px", alignItems: "center",
    background: MODE === "keyword" ? "#2980b9" : "#e67e22", color: "#fff",
    font: "14px/1.4 -apple-system, sans-serif", padding: "10px 18px",
    borderRadius: "999px", boxShadow: "0 2px 12px rgba(0,0,0,.3)",
  });
  const bannerText = document.createElement("span");
  bannerText.textContent =
    MODE === "keyword"
      ? "監視する範囲をクリック(ページ全体でもOK)"
      : "監視したい要素をクリックしてください(Escで中止)";
  banner.append(bannerText);
  if (MODE === "keyword") {
    const wholeBtn = document.createElement("button");
    wholeBtn.textContent = "ページ全体";
    Object.assign(wholeBtn.style, {
      border: "none", borderRadius: "999px", padding: "5px 12px",
      background: "#fff", color: "#2980b9", cursor: "pointer", font: "inherit", fontWeight: "600",
    });
    wholeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      stopPicking();
      openKeywordForm(""); // 空 = ページ全体
    };
    banner.append(wholeBtn);
  }
  document.documentElement.append(box, tip, banner);

  // ---- CSSセレクタ生成 ----
  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, "\\$1"));
  const isStableClass = (c) => /^[A-Za-z][A-Za-z0-9_-]{1,40}$/.test(c) && !/^(is-|has-|js-)/.test(c) && !/[0-9a-f]{6,}/i.test(c);

  function selectorFor(el) {
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
    if (!el || el === hoverEl || el === box || el === tip || banner.contains(el)) return;
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
    const selector = selectorFor(el);
    stopPicking();
    if (MODE === "keyword") openKeywordForm(selector);
    else openValueForm(el, selector);
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

  // ---- 共通のフォーム枠。extraFields と collectPayload でモード差分を注入する ----
  function openForm({ title, headerHtml, extraFieldsHtml, defaultName, collectPayload }) {
    const host = document.createElement("div");
    Object.assign(host.style, { position: "fixed", zIndex: Z + 1, inset: "0" });
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); }
        .panel {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
          background: #fff; color: #222; border-radius: 12px; padding: 20px 24px;
          width: min(460px, 92vw); max-height: 88vh; overflow: auto;
          font: 14px/1.7 -apple-system, sans-serif; box-shadow: 0 8px 40px rgba(0,0,0,.35);
        }
        h2 { margin: 0 0 12px; font-size: 16px; }
        label { display: block; margin-top: 10px; font-weight: 600; font-size: 12px; }
        input, select { width: 100%; box-sizing: border-box; padding: 6px 8px; margin-top: 2px;
          border: 1px solid #ccc; border-radius: 6px; font: inherit; background: #fff; color: #222; }
        .check { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 12px; font-weight: 600; }
        .check input { width: auto; margin: 0; }
        .preview { background: #f4f4f4; border-radius: 6px; padding: 6px 10px; font-size: 12px;
          max-height: 60px; overflow: auto; overflow-wrap: anywhere; margin-top: 4px; }
        code { font-size: 11px; overflow-wrap: anywhere; }
        .hint { font-size: 11px; color: #888; font-weight: 400; margin-top: 2px; }
        .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
        button { padding: 8px 16px; border-radius: 8px; border: none; font: inherit; cursor: pointer; }
        .primary { background: ${MODE === "keyword" ? "#2980b9" : "#e67e22"}; color: #fff; }
        .ghost { background: #eee; }
        .msg { margin-top: 10px; font-size: 12px; }
        .err { color: #c0392b; }
      </style>
      <div class="backdrop"></div>
      <div class="panel">
        <h2>${title}</h2>
        ${headerHtml}
        ${extraFieldsHtml}
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
    $("#name").value = defaultName;

    let savedDefaultWebhook = "";
    chrome.storage.sync.get({ defaultWebhook: "" }, ({ defaultWebhook }) => {
      savedDefaultWebhook = defaultWebhook || "";
      if (savedDefaultWebhook && !$("#webhook").value) $("#webhook").value = savedDefaultWebhook;
    });

    $("#cancel").onclick = () => { host.remove(); cleanup(); };
    $("#register").onclick = () => {
      const extra = collectPayload($);
      if (extra === null) return; // バリデーション失敗(collectPayload内でmsg表示済み)
      $("#register").disabled = true;
      $("#msg").textContent = "登録中…";
      $("#msg").className = "msg";
      const webhook = $("#webhook").value.trim();
      if (webhook && !savedDefaultWebhook) chrome.storage.sync.set({ defaultWebhook: webhook });
      chrome.runtime.sendMessage(
        {
          type: "cn-register",
          payload: {
            name: $("#name").value,
            url: location.href,
            interval_minutes: Number($("#interval").value),
            webhook_url: webhook,
            ...extra,
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
    return $;
  }

  // ---- 値監視フォーム ----
  function openValueForm(el, selector) {
    const preview = (el.textContent || "").replace(/\s+/g, " ").trim();
    openForm({
      title: "🔔 この要素を監視登録",
      headerHtml: `<div class="preview">${preview ? escapeHtml(preview.slice(0, 200)) : "(テキストなし)"}</div>
        <code>${escapeHtml(selector)}</code>`,
      extraFieldsHtml: "",
      defaultName: `${document.title || location.hostname}: ${preview.slice(0, 30) || selector}`,
      collectPayload: () => ({ mode: "value", selector }),
    });
  }

  // ---- キーワード出現監視フォーム ----
  function openKeywordForm(container) {
    const scopeLabel = container ? escapeHtml(container) : "ページ全体";
    const $ = openForm({
      title: "🔎 キーワード出現を監視",
      headerHtml: `<div class="hint">範囲: <code>${scopeLabel}</code> の中で、キーワードを含む項目の出現を監視します。</div>`,
      extraFieldsHtml: `
        <label>キーワード(必須)<input id="keyword" placeholder="例: 在庫あり / リモート / 再入荷">
          <div class="hint">この語を含む要素が新しく現れたら通知します。</div>
        </label>
        <label class="check"><input type="checkbox" id="withContext"> 文脈込みで取得(項目カード単位)</label>
        <label class="check"><input type="checkbox" id="notifyRemoved"> 消えた項目も通知する</label>
        <label>無視パターン(任意・正規表現)<input id="ignorePattern" placeholder="例: [0-9,]+円 など変動する部分">
          <div class="hint">閲覧数や価格など毎回変わる部分を同一判定から除外したいとき。</div>
        </label>`,
      defaultName: `${document.title || location.hostname}: キーワード監視`,
      collectPayload: ($) => {
        const keyword = $("#keyword").value.trim();
        if (!keyword) {
          $("#msg").className = "msg err";
          $("#msg").textContent = "❌ キーワードを入力してください";
          return null;
        }
        return {
          mode: "keyword",
          selector: container, // 空 = ページ全体
          keyword,
          with_context: $("#withContext").checked,
          notify_removed: $("#notifyRemoved").checked,
          ignore_pattern: $("#ignorePattern").value.trim(),
        };
      },
    });
    // キーワード欄にフォーカス
    setTimeout(() => $("#keyword")?.focus(), 0);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
