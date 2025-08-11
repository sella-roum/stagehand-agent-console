/**
 * @file シンプルなファイルベースのキャッシュ機能を提供します。
 */
import { ObserveResult, Page } from "@browserbasehq/stagehand";
import fs from "fs/promises";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import chalk from "chalk";
import lockfile, { LockOptions } from "proper-lockfile";
import { drawObserveOverlay, clearOverlays } from "./ui";
import { ElementNotFoundError } from "@/src/errors";

/**
 * 文字列を数値に安全に変換します。パースできない場合はフォールバック値を返します。
 * @param value - 変換する文字列またはundefined。
 * @param fallback - パース失敗時に返すデフォルト値。
 * @returns パースされた数値またはフォールバック値。
 */
function toNum(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// 専用ディレクトリ内にキャッシュを保存し、パスの安全性を確保
const CACHE_DIR = path.resolve(process.cwd(), ".stagehand");
const CACHE_FILE =
  process.env.STAGEHAND_CACHE_FILE ?? path.join(CACHE_DIR, "cache.json");
const MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * キャッシュディレクトリが存在することを保証します。
 */
async function ensureCacheDir() {
  // CACHE_FILE が環境変数で外部パスに変更された場合にも対応
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
}

/**
 * キャッシュキーを生成します。URLと指示をハッシュ化して、安全性と一意性を高めます。
 * @param url - 現在のページのURL。
 * @param instruction - ユーザーからの指示。
 * @returns 生成されたハッシュキー文字列。
 */
function getCacheKey(url: string, instruction: string): string {
  const secret = process.env.STAGEHAND_CACHE_SALT;
  try {
    const urlObject = new URL(url);
    const site = `${urlObject.origin}${urlObject.pathname}`;
    const payload = JSON.stringify({ site, instruction });
    const hasher = secret ? createHmac("sha256", secret) : createHash("sha256");
    return hasher.update(payload).digest("hex");
  } catch (e) {
    // about:blankなどの場合は指示のみのハッシュ
    const hasher = secret ? createHmac("sha256", secret) : createHash("sha256");
    return hasher.update(instruction).digest("hex");
  }
}

/**
 * ファイルロックのための共通オプション。堅牢性を高めます。
 */
const lockOptions: LockOptions = {
  stale: toNum(process.env.STAGEHAND_CACHE_LOCK_STALE_MS, 10_000),
  retries: {
    retries: toNum(process.env.STAGEHAND_CACHE_LOCK_RETRIES, 5),
    factor: toNum(process.env.STAGEHAND_CACHE_LOCK_BACKOFF_FACTOR, 1.5),
    minTimeout: toNum(process.env.STAGEHAND_CACHE_LOCK_MIN_MS, 100),
    maxTimeout: toNum(process.env.STAGEHAND_CACHE_LOCK_MAX_MS, 1000),
  },
};

/**
 * シリアライズされたキャッシュ文字列をファイルにアトミックに書き込みます。
 * @param serializedCache - 書き込むシリアライズ済みのキャッシュ文字列。
 */
async function writeCacheObject(serializedCache: string) {
  const tmpFile = `${CACHE_FILE}.tmp`;
  await fs.writeFile(tmpFile, serializedCache, {
    mode: 0o600,
  });
  await fs.rename(tmpFile, CACHE_FILE);
}

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
  try {
    await ensureCacheDir();
  } catch (e) {
    console.warn(
      chalk.yellow(
        "キャッシュディレクトリ作成に失敗したため、書き込みをスキップします:",
      ),
      e,
    );
    return;
  }

  const key = getCacheKey(page.url(), instruction);
  let release: (() => Promise<void>) | undefined;
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
        // 既存の巨大ファイルを空でリセットして回復可能にする
        await writeCacheObject("{}");
      } else {
        const existingCache = await fs.readFile(CACHE_FILE, "utf-8");
        cache = JSON.parse(existingCache);
      }
    } catch (error) {
      // ファイルが存在しない場合は、空のキャッシュから開始
    }
    cache[key] = actionToCache;

    const serialized = JSON.stringify(cache);
    if (Buffer.byteLength(serialized, "utf8") > MAX_CACHE_SIZE) {
      console.warn(
        chalk.yellow(
          `キャッシュサイズが上限(${MAX_CACHE_SIZE} bytes)を超えるため書き込みをスキップ: ${CACHE_FILE}`,
        ),
      );
      return;
    }
    await writeCacheObject(serialized);
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
  try {
    await ensureCacheDir();
  } catch (e) {
    if (process.env.DEBUG_CACHE === "1") {
      console.warn(
        chalk.yellow(
          "キャッシュディレクトリ作成に失敗したため、読み取りをスキップします:",
        ),
        e,
      );
    }
    return null;
  }

  const key = getCacheKey(page.url(), instruction);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(CACHE_FILE, lockOptions);
    try {
      const stats = await fs.stat(CACHE_FILE);
      if (stats.size > MAX_CACHE_SIZE) {
        console.warn(
          chalk.yellow(
            `キャッシュが上限(${MAX_CACHE_SIZE} bytes)超過のため読み取りをスキップ: ${CACHE_FILE}`,
          ),
        );
        return null;
      }
    } catch {
      // stat 失敗（ファイル無しなど）は既存の例外ハンドリングに委ねる
    }
    const existingCache = await fs.readFile(CACHE_FILE, "utf-8");
    try {
      const cache: Record<string, ObserveResult> = JSON.parse(existingCache);
      return cache[key] ?? null;
    } catch (e) {
      if (process.env.DEBUG_CACHE === "1") {
        console.warn(
          chalk.yellow(
            "キャッシュファイルの JSON 解析に失敗しました。読み取りをスキップします:",
          ),
          e,
        );
      }
      return null;
    }
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
 * 指定されたキーのキャッシュエントリを削除します。
 * @param page - 現在のPageオブジェクト。
 * @param instruction - 削除するキャッシュエントリの指示。
 */
export async function deleteCacheKey(
  page: Page,
  instruction: string,
): Promise<void> {
  try {
    await ensureCacheDir();
  } catch (e) {
    console.warn(
      chalk.yellow(
        "キャッシュディレクトリ作成に失敗したため、削除をスキップします:",
      ),
      e,
    );
    return;
  }

  const key = getCacheKey(page.url(), instruction);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(CACHE_FILE, lockOptions);
    let cache: Record<string, ObserveResult> = {};
    try {
      const existingCache = await fs.readFile(CACHE_FILE, "utf-8");
      cache = JSON.parse(existingCache);
    } catch {
      // ファイルが存在しない場合は何もせず終了
      return;
    }
    if (key in cache) {
      delete cache[key];
      await writeCacheObject(JSON.stringify(cache));
    }
  } finally {
    if (release) await release();
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
    if (process.env.DEBUG_CACHE === "1") {
      console.log(chalk.blue("キャッシュされたアクションを使用:"), instruction);
    }
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
      // 失敗したキャッシュを無効化
      try {
        await deleteCacheKey(page, instruction);
      } catch (e) {
        if (process.env.DEBUG_CACHE === "1") {
          console.warn(chalk.yellow("キャッシュ無効化に失敗しました"), e);
        }
      }
    }
  }

  const results = await page.observe(instruction);
  // デバッグフラグが有効な場合のみ詳細ログを出力
  if (process.env.DEBUG_CACHE === "1") {
    console.log(chalk.blue("Observe結果:"), results);
  }

  if (results.length === 0) {
    throw new ElementNotFoundError(
      `キャッシュ用の要素が見つかりませんでした: ${instruction}`,
      "act_with_cache",
      { instruction },
      instruction,
    );
  }

  const actionToCache = results[0];
  if (process.env.DEBUG_CACHE === "1") {
    console.log(chalk.blue("アクションをキャッシュします:"), actionToCache);
  }
  await simpleCache(page, instruction, actionToCache);

  // ユーザーにどの要素が対象か視覚的にフィードバック
  try {
    await drawObserveOverlay(page, results);
    await page.waitForTimeout(overlayDuration);
  } finally {
    await clearOverlays(page);
  }

  await page.act(actionToCache);
}
