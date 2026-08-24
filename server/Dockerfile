# Playwright公式イメージ(Chromium + 依存ライブラリ入り)。playwrightのnpmバージョンと合わせること
FROM mcr.microsoft.com/playwright:v1.54.0-noble

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# 同梱Chromiumではなく実Google Chromeを使う(x86_64限定)。
# CloudflareのBot ManagementはバンドルChromiumのTLS/JA3指紋を検知することがあるため。
RUN npx playwright install --with-deps chrome

ENV DATA_DIR=/data
EXPOSE 8787
# ヘッドフルChromiumを動かすため仮想ディスプレイ(Xvfb)上でnodeを起動する。
# xvfb-run はPlaywright公式イメージに同梱されている。
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1366x900x24", "node", "dist/index.js"]
