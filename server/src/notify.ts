import type { Watch } from "./db.js";

const globalWebhook = process.env.DISCORD_WEBHOOK_URL || null;

function truncate(s: string, max = 900): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function send(watch: Watch, embed: Record<string, unknown>): Promise<void> {
  const webhook = watch.webhook_url || globalWebhook;
  if (!webhook) {
    console.log(`[notify] webhook未設定のため通知スキップ: ${watch.name}`);
    return;
  }
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ChangeNotifier", embeds: [embed] }),
  });
  if (!res.ok) {
    console.error(`[notify] Discord通知失敗 (${res.status}): ${await res.text()}`);
  }
}

/** 監視対象の値が変化したときの通知 */
export async function notifyChange(
  watch: Watch,
  oldValue: string | null,
  newValue: string
): Promise<void> {
  await send(watch, {
    title: `🔔 変更検知: ${watch.name}`,
    url: watch.url,
    color: 0xe67e22,
    fields: [
      { name: "変更前", value: truncate(oldValue ?? "(初回)") || "(空)" },
      { name: "変更後", value: truncate(newValue) || "(空)" },
    ],
    timestamp: new Date().toISOString(),
  });
}

/** 要素が取得できなくなったとき(正常→エラー)の通知 */
export async function notifyError(watch: Watch, message: string): Promise<void> {
  await send(watch, {
    title: `⚠️ 監視エラー: ${watch.name}`,
    url: watch.url,
    color: 0xe74c3c,
    description:
      "監視対象の要素が取得できなくなりました(ページ構造の変更・要素の削除・botブロックなどの可能性)。",
    fields: [
      { name: "セレクタ", value: truncate(watch.selector, 300) },
      { name: "エラー内容", value: truncate(message, 500) },
    ],
    timestamp: new Date().toISOString(),
  });
}

/** 取得できなくなっていた要素が再び取れるようになったとき(エラー→正常)の通知 */
export async function notifyRecovered(watch: Watch, value: string): Promise<void> {
  await send(watch, {
    title: `✅ 復帰: ${watch.name}`,
    url: watch.url,
    color: 0x2ecc71,
    description: "取得できなくなっていた要素が、再び取得できるようになりました。",
    fields: [{ name: "現在の値", value: truncate(value) || "(空)" }],
    timestamp: new Date().toISOString(),
  });
}

/** [キーワード監視] キーワードを含む項目が増減したときの通知 */
export async function notifyKeyword(
  watch: Watch,
  added: string[],
  removed: string[]
): Promise<void> {
  const list = (items: string[]) => truncate(items.map((t) => `・${t}`).join("\n"), 900) || "(なし)";
  const fields: Array<{ name: string; value: string }> = [];
  if (added.length) fields.push({ name: `🆕 新しく出現 (${added.length}件)`, value: list(added) });
  if (removed.length) fields.push({ name: `❌ 消えた (${removed.length}件)`, value: list(removed) });
  if (!fields.length) return;
  await send(watch, {
    title: `🔎 キーワード出現: ${watch.name}`,
    url: watch.url,
    color: 0x3498db,
    description: `キーワード「${watch.keyword ?? ""}」にマッチする項目に変化がありました。`,
    fields,
    timestamp: new Date().toISOString(),
  });
}
