import { chromium, type Browser, type Page } from "playwright";

let browser: Browser | null = null;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    // ヘッドフル(headless:false)で起動する。Akamai等のbot対策はヘッドレスを検知して
    // 403を返すため、実ブラウザ相当のヘッドフルが必要。画面のないサーバ上ではXvfb
    // (仮想ディスプレイ)経由で動かす(Dockerではxvfb-runでnodeを起動)。
    // channel:"chrome" でPlaywright同梱Chromiumではなく実Google Chromeを使う。
    // CloudflareのBot Managementはバンドル版ChromiumのTLS/JA3指紋を検知することがあるため。
    browser = await chromium.launch({
      headless: false,
      channel: "chrome",
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
  }
  return browser;
}

// navigator.webdriver等、自動操作の痕跡を消すステルスパッチ
const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
  window.chrome = window.chrome || { runtime: {} };
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
`;

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

/** ページを開いてnavigate・HTTPステータス確認まで行い、コールバックに渡す */
async function withPage<T>(url: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const context = await b.newContext({ userAgent: USER_AGENT, locale: "ja-JP" });
  await context.addInitScript(STEALTH_INIT_SCRIPT);
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
    return await fn(page);
  } finally {
    await context.close();
  }
}

/** [値監視] セレクタに一致する要素のテキストを取得して正規化する */
export async function fetchValue(url: string, selector: string): Promise<string> {
  return withPage(url, async (page) => {
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
  });
}

/**
 * [キーワード監視] 範囲内で keyword を含む「最内側の要素」を項目単位として集める。
 * withContext=true なら、最内側から繰り返し兄弟が現れる階層まで遡って文脈込みにする。
 * container が空ならページ全体を対象。返り値は重複除去済みの項目テキスト配列。
 */
export async function fetchKeywordMatches(
  url: string,
  keyword: string,
  container: string | null,
  withContext: boolean
): Promise<string[]> {
  return withPage(url, async (page) => {
    // 動的生成されるリストのために少し待つ
    await page.waitForTimeout(1500);
    const result = await page.evaluate(
      ({ keyword, container, withContext }) => {
        const root: Element | null = container
          ? document.querySelector(container)
          : document.body;
        if (!root) return null; // コンテナが見つからない → 呼び出し側でエラー扱い

        const has = (el: Element) => (el.textContent ?? "").includes(keyword);
        const sig = (el: Element) => el.tagName + "|" + Array.from(el.classList).join(".");

        const items: string[] = [];
        for (const el of Array.from(root.querySelectorAll("*"))) {
          if (!has(el)) continue;
          // 最内側判定: 子孫のいずれもキーワードを含まない = 出現箇所の最小の器
          if (Array.from(el.children).some((c) => has(c))) continue;

          let unit: Element = el;
          if (withContext) {
            // 同じ構造の兄弟が複数いる祖先(=繰り返し項目)まで遡る
            let cur: Element = el;
            while (cur !== root && cur.parentElement) {
              const twins = Array.from(cur.parentElement.children).filter(
                (s) => sig(s) === sig(cur)
              );
              if (twins.length >= 2) {
                unit = cur;
                break;
              }
              cur = cur.parentElement;
            }
          }
          const text = (unit.textContent ?? "").replace(/\s+/g, " ").trim();
          if (text) items.push(text);
        }
        return Array.from(new Set(items));
      },
      { keyword, container, withContext }
    );

    if (result === null) {
      throw new Error(
        `監視範囲(コンテナ)が見つかりません: ${container}(ページ構造が変わった可能性)`
      );
    }
    return result;
  });
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
