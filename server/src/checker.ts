import { chromium, type Browser } from "playwright";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    // ヘッドフル(headless:false)で起動する。Akamai等のbot対策はヘッドレスを検知して
    // 403を返すため、実ブラウザ相当のヘッドフルが必要。画面のないサーバ上ではXvfb
    // (仮想ディスプレイ)経由で動かす(Dockerではxvfb-runでnodeを起動)。
    browser = await chromium.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

/** ページを開き、セレクタに一致する要素のテキストを取得して正規化する */
export async function fetchValue(url: string, selector: string): Promise<string> {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "ja-JP",
  });
  try {
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const status = resp?.status();
    // bot対策や認証で本来のページが返らないケースを分かりやすいエラーにする
    if (status && status >= 400) {
      throw new Error(
        `ページがHTTP ${status}を返しました(botブロックやログイン必須の可能性)。要素は取得できません。`
      );
    }
    const el = page.locator(selector).first();
    try {
      await el.waitFor({ state: "attached", timeout: 15_000 });
    } catch {
      throw new Error(
        `セレクタに一致する要素が見つかりません: ${selector}(サイトが監視側に別の内容を返しているか、動的に生成されている可能性)`
      );
    }
    const text = (await el.textContent()) ?? "";
    return normalize(text);
  } finally {
    await context.close();
  }
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
