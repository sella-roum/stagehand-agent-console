/**
 * @file シンプルなファイルベースのキャッシュ機能を提供します。
 */
import { ObserveResult, Page } from "@browserbasehq/stagehand";
import fs from "fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import chalk from "chalk";
import lockfile from "proper-lockfile";
import { drawObserveOverlay, clearOverlays } from "./ui";

// 専用ディレクトリ内にキャッシュを保存し、パスの安全性を確保
const CACHE_DIR = path.resolve(process.cwd(), ".stagehand");
const CACHE_FILE =
  process.env.STAGEHAND_CACHE_FILE ?? path.join(CACHE_DIR, "cache.json");
const MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * キャッシュディレクトリが存在することを保証します。
 */
async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

/**
 * キャッシュキーを生成します。URLと指示をハッシュ化して、安全性と一意性を高めます。
 * @param url - 現在のページのURL。
 * @param instruction - ユーザーからの指示。
 * @returns 生成されたSHA-256ハッシュキー文字列。
 */
function getCacheKey(url: string, instruction: string): string {
  try {
    const urlObject = new URL(url);
    const site = `${urlObject.origin}${urlObject.pathname}`;
    const payload = JSON.stringify({ site, instruction });
    return createHash("sha256").update(payload).digest("hex");
  } catch (e) {
    // about:blankなどの場合は指示のみのハッシュ
    return createHash("sha256").update(instruction).digest("hex");
  }
}

/**
 * ファイルロックのための共通オプション。堅牢性を高めます。
 */
const lockOptions = {
  stale: 10_000, // 10秒でロックを古くなったと判断
  retries: { retries: 5, factor: 1.5, minTimeout: 100, maxTimeout: 1000 },
};

/**
 * `observe`の結果を`cache.json`にアトミックに保存します。
 * @param page - 現在のPageオブジェクト。
 * @param instruction - キャッシュキーとして使用する指示。
 * @param actionToCache - キャッシュする`ObserveResult`オブジェクト。
 */
export async function simpleCache(
  page: Page,
  instruction: string,
  actionToCache: ObserveResult,
) {
  await ensureCacheDir();
  const key = getCacheKey(page.url(), instruction);
  let release;
  try {
    release = await lockfile.lock(CACHE_FILE, lockOptions);
    let cache: Record<string, ObserveResult> = {};
    try {
      const stats = await fs.stat(CACHE_FILE);
      if (stats.size > MAX_CACHE_SIZE) {
        console.warn(
          chalk.yellow(
            `キャッシュが上限(${MAX_CACHE_SIZE} bytes)超過のためリセット: ${CACHE_FILE}`,
          ),
        );
      } else {
        const existingCache = await fs.readFile(CACHE_FILE, "utf-8");
        cache = JSON.parse(existingCache);
      }
    } catch (error) {
      // ファイルが存在しない場合は、空のキャッシュから開始
    }
    cache[key] = actionToCache;

    // アトミックな書き込み（テンポラリファイル -> rename）
    const tmpFile = `${CACHE_FILE}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(cache, null, 2));
    await fs.rename(tmpFile, CACHE_FILE);
  } catch (error) {
    console.error(chalk.red("キャッシュへの保存に失敗しました:"), error);
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * `cache.json`から指示に対応するキャッシュ済みアクションを安全に読み込みます。
 * @param page - 現在のPageオブジェクト。
 * @param instruction - 検索する指示。
 * @returns キャッシュされた`ObserveResult`オブジェクト。見つからない場合はnull。
 */
export async function readCache(
  page: Page,
  instruction: string,
): Promise<ObserveResult | null> {
  await ensureCacheDir();
  const key = getCacheKey(page.url(), instruction);
  let release;
  try {
    release = await lockfile.lock(CACHE_FILE, lockOptions);
    const existingCache = await fs.readFile(CACHE_FILE, "utf-8");
    const cache: Record<string, ObserveResult> = JSON.parse(existingCache);
    return cache[key] || null;
  } catch (error) {
    // ファイルが存在しない、または読み込めない場合はキャッシュなしとみなす
    return null;
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * キャッシュを利用して`act`操作を実行します。
 * @param page - 操作対象のPageオブジェクト。
 * @param instruction - 実行したい操作の自然言語指示。
 * @param overlayDuration - オーバーレイを表示する時間（ミリ秒）。
 * @throws {Error} `observe`で操作対象の要素が見つからなかった場合にエラーをスローします。
 */
export async function actWithCache(
  page: Page,
  instruction: string,
  overlayDuration: number = 1000,
): Promise<void> {
  const cachedAction = await readCache(page, instruction);
  if (cachedAction) {
    console.log(chalk.blue("キャッシュされたアクションを使用:"), instruction);
    try {
      await page.act(cachedAction);
      return;
    } catch (err) {
      console.warn(
        chalk.yellow(
          "キャッシュ済みアクションの実行に失敗。再観察にフォールバックします。",
        ),
        err,
      );
      // ここでキャッシュを無効化する処理を追加することも可能
    }
  }

  const results = await page.observe(instruction);
  // デバッグフラグが有効な場合のみ詳細ログを出力
  if (process.env.DEBUG_CACHE === "1") {
    console.log(chalk.blue("Observe結果:"), results);
  }

  if (results.length === 0) {
    throw new Error(
      `キャッシュ用の要素が見つかりませんでした: "${instruction}"`,
    );
  }

  const actionToCache = results[0];
  if (process.env.DEBUG_CACHE === "1") {
    console.log(chalk.blue("アクションをキャッシュします:"), actionToCache);
  }
  await simpleCache(page, instruction, actionToCache);

  // ユーザーにどの要素が対象か視覚的にフィードバック
  await drawObserveOverlay(page, results);
  await page.waitForTimeout(overlayDuration);
  await clearOverlays(page);

  await page.act(actionToCache);
}
