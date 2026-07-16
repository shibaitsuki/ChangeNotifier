import { addHistory, dueWatches, recordCheck, recordError, type Watch } from "./db.js";
import { fetchValue } from "./checker.js";
import { notifyChange } from "./notify.js";

let running = false;

/** 1つの監視対象をチェックする。変更があれば履歴保存+通知。 */
export async function checkWatch(watch: Watch): Promise<{ changed: boolean; value: string }> {
  const value = await fetchValue(watch.url, watch.selector);
  const changed = watch.last_value !== null && watch.last_value !== value;
  if (changed) {
    addHistory(watch.id, watch.last_value, value);
    notifyChange(watch, watch.last_value, value).catch((e) =>
      console.error(`[notify] ${watch.name}: ${e}`)
    );
  }
  recordCheck(watch.id, value);
  return { changed, value };
}

async function tick(): Promise<void> {
  if (running) return; // 前回のtickが長引いている間は重ねない
  running = true;
  try {
    for (const watch of dueWatches()) {
      try {
        const { changed } = await checkWatch(watch);
        console.log(
          `[check] ${watch.name} (${watch.url}) → ${changed ? "変更あり" : "変更なし"}`
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        recordError(watch.id, message);
        console.error(`[check] ${watch.name} 失敗: ${message}`);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  const intervalMs = 60_000;
  setInterval(() => void tick(), intervalMs);
  void tick();
  console.log("[scheduler] 起動 (60秒ごとに巡回チェック)");
}
