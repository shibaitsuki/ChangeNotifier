import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "change-notifier.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  selector TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 30,
  webhook_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_value TEXT,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  mode TEXT NOT NULL DEFAULT 'value',
  keyword TEXT,
  with_context INTEGER NOT NULL DEFAULT 0,
  notify_removed INTEGER NOT NULL DEFAULT 0,
  ignore_pattern TEXT
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  old_value TEXT,
  new_value TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// 既存DB(キーワードモード列が無い頃に作られたもの)向けのマイグレーション。
// CREATE TABLE IF NOT EXISTS は既存テーブルに列を足さないので、個別にALTERする。
const existingCols = new Set(
  (db.prepare("PRAGMA table_info(watches)").all() as { name: string }[]).map((c) => c.name)
);
const addColumn = (name: string, ddl: string) => {
  if (!existingCols.has(name)) db.exec(`ALTER TABLE watches ADD COLUMN ${ddl}`);
};
addColumn("mode", "mode TEXT NOT NULL DEFAULT 'value'");
addColumn("keyword", "keyword TEXT");
addColumn("with_context", "with_context INTEGER NOT NULL DEFAULT 0");
addColumn("notify_removed", "notify_removed INTEGER NOT NULL DEFAULT 0");
addColumn("ignore_pattern", "ignore_pattern TEXT");

export type WatchMode = "value" | "keyword";

export interface Watch {
  id: number;
  name: string;
  url: string;
  /** value: 監視する要素。keyword: 監視範囲のコンテナ(空文字ならページ全体) */
  selector: string;
  interval_minutes: number;
  webhook_url: string | null;
  enabled: number;
  /** value: 前回の要素テキスト。keyword: 前回マッチした項目テキストのJSON配列 */
  last_value: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  mode: WatchMode;
  keyword: string | null;
  /** keyword: 最内側だけでなく繰り返し兄弟の階層まで文脈を含める */
  with_context: number;
  /** keyword: 消失した項目も通知する */
  notify_removed: number;
  /** keyword: 同一判定の前に取り除く正規表現(変動する数字列などのノイズ除去) */
  ignore_pattern: string | null;
}

export interface HistoryRow {
  id: number;
  watch_id: number;
  old_value: string | null;
  new_value: string;
  changed_at: string;
}

export function listWatches(): Watch[] {
  return db.prepare("SELECT * FROM watches ORDER BY id DESC").all() as Watch[];
}

export function getWatch(id: number): Watch | undefined {
  return db.prepare("SELECT * FROM watches WHERE id = ?").get(id) as Watch | undefined;
}

export function createWatch(w: {
  name: string;
  url: string;
  selector: string;
  interval_minutes: number;
  webhook_url?: string | null;
  mode?: WatchMode;
  keyword?: string | null;
  with_context?: boolean;
  notify_removed?: boolean;
  ignore_pattern?: string | null;
}): Watch {
  const info = db
    .prepare(
      `INSERT INTO watches
       (name, url, selector, interval_minutes, webhook_url, mode, keyword, with_context, notify_removed, ignore_pattern)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      w.name,
      w.url,
      w.selector,
      w.interval_minutes,
      w.webhook_url ?? null,
      w.mode ?? "value",
      w.keyword ?? null,
      w.with_context ? 1 : 0,
      w.notify_removed ? 1 : 0,
      w.ignore_pattern ?? null
    );
  return getWatch(Number(info.lastInsertRowid))!;
}

export function deleteWatch(id: number): void {
  db.prepare("DELETE FROM history WHERE watch_id = ?").run(id);
  db.prepare("DELETE FROM watches WHERE id = ?").run(id);
}

export function setEnabled(id: number, enabled: boolean): void {
  db.prepare("UPDATE watches SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function setInterval(id: number, minutes: number): void {
  db.prepare("UPDATE watches SET interval_minutes = ? WHERE id = ?").run(minutes, id);
}

export function recordCheck(id: number, value: string): void {
  db.prepare(
    "UPDATE watches SET last_value = ?, last_checked_at = datetime('now'), last_error = NULL WHERE id = ?"
  ).run(value, id);
}

export function recordError(id: number, message: string): void {
  db.prepare(
    "UPDATE watches SET last_checked_at = datetime('now'), last_error = ? WHERE id = ?"
  ).run(message, id);
}

export function addHistory(watchId: number, oldValue: string | null, newValue: string): void {
  db.prepare("INSERT INTO history (watch_id, old_value, new_value) VALUES (?, ?, ?)").run(
    watchId,
    oldValue,
    newValue
  );
}

export function listHistory(watchId: number, limit = 50): HistoryRow[] {
  return db
    .prepare("SELECT * FROM history WHERE watch_id = ? ORDER BY id DESC LIMIT ?")
    .all(watchId, limit) as HistoryRow[];
}

export function dueWatches(): Watch[] {
  return db
    .prepare(
      `SELECT * FROM watches
       WHERE enabled = 1
         AND (last_checked_at IS NULL
              OR datetime(last_checked_at, '+' || interval_minutes || ' minutes') <= datetime('now'))`
    )
    .all() as Watch[];
}
