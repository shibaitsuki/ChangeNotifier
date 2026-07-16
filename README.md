# ChangeNotifier

Webページの要素をクリックで選んで監視登録し、変更があったらDiscordに通知するセルフホスト型監視システム(Distill風)。

```
[Chrome拡張] 要素をクリック選択 → [サーバ(Docker常駐)] 定期チェック → [Discord] 変更通知
```

## 構成

- `extension/` — Chrome拡張(Manifest V3)。ページ上の要素をハイライト&クリックで選択し、CSSセレクタを生成してサーバに登録
- `server/` — Node.js + Fastify + Playwright + SQLite。60秒ごとに期限が来た監視対象を巡回し、要素テキストの変化を検知したら履歴保存 + Discord Webhook通知。`http://localhost:8787` に管理UIあり

## セットアップ

### 1. サーバを起動

**Docker(常時稼働向け):**

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/…"  # 省略可(監視ごとに指定も可能)
docker compose up -d --build
```

**ローカル開発:**

```bash
cd server
npm install
npx playwright install chromium
npm run dev
```

### 2. Chrome拡張を読み込む

1. Chromeで `chrome://extensions` を開く
2. 「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」→ `extension/` フォルダを選択

### 3. 監視を登録する

1. 監視したいページを開き、拡張アイコン → 「🎯 要素を選択して監視登録」
2. 要素にマウスを乗せるとハイライトされるのでクリック
3. 監視名・チェック間隔・(必要なら)Webhook URLを入れて登録

登録後は `http://localhost:8787` の管理UIで状態確認・手動チェック・履歴閲覧・削除ができる。

## NASなどリモートのDockerホストで動かす場合

1. このリポジトリをNASにコピーして、NAS上で `docker compose up -d --build`
   ```bash
   rsync -av --exclude node_modules --exclude data --exclude dist ./ user@192.168.10.19:~/change-notifier/
   ssh user@192.168.10.19 "cd ~/change-notifier && docker compose up -d --build"
   ```
   (SynologyならContainer Manager の「プロジェクト」機能でこのフォルダを指定してもよい)
2. 拡張のポップアップで「サーバURL」を `http://192.168.10.19:8787` に変更
3. 管理UIも `http://192.168.10.19:8787` で開ける

拡張の `manifest.json` の `host_permissions` にはNASのIP(`http://192.168.10.19/*`)を含めてある。IPが違う場合はそこを書き換えて拡張を再読み込みする。

## Discord Webhook の作り方

Discordのサーバ設定 → 連携サービス → ウェブフック → 新しいウェブフック → URLをコピー。

## メモ / 制限

- 監視値は要素の `textContent`(空白正規化済み)。画像や属性の変化は検知しない
- ログインが必要なページはサーバ側ヘッドレスブラウザでは再現できない(Cookie引き継ぎは未実装)
- 通知はDiscordのみ。メール対応は nodemailer か Apprise を `server/src/notify.ts` に足せば拡張できる
