import { addHistory, dueWatches, recordCheck, recordError, type Watch } from "./db.js";
import { fetchValue, fetchKeywordMatches } from "./checker.js";
import { notifyChange, notifyError, notifyRecovered, notifyKeyword } from "./notify.js";

let running = false;

const logNotifyErr = (watch: Watch) => (e: unknown) =>
  console.error(`[notify] ${watch.name}: ${e}`);

export type CheckResult =
  | { ok: true; changed: boolean; recovered: boolean; value?: string; added?: string[]; removed?: string[] }
  | { ok: false; newlyFailed: boolean; error: string };

/**
 * 1つの監視対象をチェックする。モードに応じて値監視/キーワード監視を行い、
 * 取得失敗(正常→エラー)は遷移時だけ通知する。チェック起因の失敗ではthrowせず結果で返す。
 */
export async function checkWatch(watch: Watch): Promise<CheckResult> {
  const wasErroring = watch.last_error !== null;
  try {
    return watch.mode === "keyword"
      ? await checkKeyword(watch, wasErroring)
      : await checkValue(watch, wasErroring);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    recordError(watch.id, message);
    // すでにエラー状態だった場合は再通知しない(遷移したときだけ通知)
    if (!wasErroring) notifyError(watch, message).catch(logNotifyErr(watch));
    return { ok: false, newlyFailed: !wasErroring, error: message };
  }
}

/** 値監視: 要素テキストの変化・復帰を検知 */
async function checkValue(watch: Watch, wasErroring: boolean): Promise<CheckResult> {
  const value = await fetchValue(watch.url, watch.selector);
  const changed = watch.last_value !== null && watch.last_value !== value;
  if (changed) addHistory(watch.id, watch.last_value, value);
  if (wasErroring) {
    // エラー→正常。値が変わっていても復帰通知に集約する(二重通知を避ける)
    notifyRecovered(watch, value).catch(logNotifyErr(watch));
  } else if (changed) {
    notifyChange(watch, watch.last_value, value).catch(logNotifyErr(watch));
  }
  recordCheck(watch.id, value);
  return { ok: true, changed, recovered: wasErroring, value };
}

/** キーワード監視: マッチ項目集合の差分(追加・任意で消失)を検知 */
async function checkKeyword(watch: Watch, wasErroring: boolean): Promise<CheckResult> {
  const container = watch.selector.trim() || null; // 空ならページ全体
  const items = await fetchKeywordMatches(
    watch.url,
    watch.keyword ?? "",
    container,
    watch.with_context === 1
  );

  // 同一判定用のID(任意の無視パターンで変動部分を除去)
  const ident = makeIdentityFn(watch.ignore_pattern);
  const prev: string[] = watch.last_value ? safeParseArray(watch.last_value) : [];
  const isFirstCheck = watch.last_value === null;

  const prevIds = new Set(prev.map(ident));
  const curIds = new Set(items.map(ident));
  const added = items.filter((t) => !prevIds.has(ident(t)));
  const removed = prev.filter((t) => !curIds.has(ident(t)));

  const changed = added.length > 0 || (watch.notify_removed === 1 && removed.length > 0);

  // 初回は基準を作るだけ。以降、差分があれば通知(消失は設定時のみ)
  if (!isFirstCheck && changed) {
    if (added.length) addHistory(watch.id, prev.join(" | ") || null, items.join(" | "));
    notifyKeyword(watch, added, watch.notify_removed === 1 ? removed : []).catch(logNotifyErr(watch));
  }
  recordCheck(watch.id, JSON.stringify(items));
  return { ok: true, changed, recovered: wasErroring, added, removed };
}

/** ignore_pattern(正規表現)で変動部分を除去した文字列を返す関数を作る。不正な正規表現は無視。 */
function makeIdentityFn(pattern: string | null): (s: string) => string {
  if (!pattern) return (s) => s;
  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch {
    return (s) => s;
  }
  return (s) => s.replace(re, "").replace(/\s+/g, " ").trim();
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function tick(): Promise<void> {
  if (running) return; // 前回のtickが長引いている間は重ねない
  running = true;
  try {
    for (const watch of dueWatches()) {
      try {
        const result = await checkWatch(watch);
        if (result.ok) {
          const state = result.recovered ? "復帰" : result.changed ? "変更あり" : "変更なし";
          console.log(`[check] ${watch.name} (${watch.url}) → ${state}`);
        } else {
          console.error(`[check] ${watch.name} 失敗: ${result.error}`);
        }
      } catch (e) {
        // fetch以外の予期しない失敗で巡回ループが止まらないようにする
        console.error(`[check] ${watch.name} 予期しないエラー: ${e}`);
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
