import type { Watch } from "./db.js";

const globalWebhook = process.env.DISCORD_WEBHOOK_URL || null;

function truncate(s: string, max = 900): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export async function notifyChange(
  watch: Watch,
  oldValue: string | null,
  newValue: string
): Promise<void> {
  const webhook = watch.webhook_url || globalWebhook;
  if (!webhook) {
    console.log(`[notify] webhook未設定のため通知スキップ: ${watch.name}`);
    return;
  }
  const body = {
    username: "ChangeNotifier",
    embeds: [
      {
        title: `🔔 変更検知: ${watch.name}`,
        url: watch.url,
        color: 0xe67e22,
        fields: [
          { name: "変更前", value: truncate(oldValue ?? "(初回)") || "(空)" },
          { name: "変更後", value: truncate(newValue) || "(空)" },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[notify] Discord通知失敗 (${res.status}): ${await res.text()}`);
  }
}
