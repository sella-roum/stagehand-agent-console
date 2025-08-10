/**
 * @file シンプルなファイルベースのキャッシュ機能を提供します。
 */
import { ObserveResult, Page } from "@browserbasehq/stagehand";
import fs from "fs/promises";
import chalk from "chalk";
import { drawObserveOverlay, clearOverlays } from "./ui";

/**
 * キャッシュキーを生成します。URLと指示を基に一意のキーを作成します。
 * @param url - 現在のページのURL。
 * @param instruction - ユーザーからの指示。
 * @returns 生成されたキャッシュキー文字列。
 */
function getCacheKey(url: string, instruction: string): string {
  try {
    const urlObject = new URL(url);
    const key = `${urlObject.hostname}${urlObject.pathname} | ${instruction}`;
    return key;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // about:blankのような無効なURLの場合は、指示のみをキーとする
    return instruction;
  }
}

/**
 * `observe`の結果を`cache.json`に保存します。
 * @param page - 現在のPageオブジェクト。
 * @param instruction - キャッシュキーとして使用する指示。
 * @param actionToCache - キャッシュする`ObserveResult`オブジェクト。
 */
export async function simpleCache(
  page: Page,
  instruction: string,
  actionToCache: ObserveResult,
) {
  const key = getCacheKey(page.url(), instruction);
  try {
    let cache: Record<string, ObserveResult> = {};
    try {
      const existingCache = await fs.readFile("cache.json", "utf-8");
      cache = JSON.parse(existingCache);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // ファイルが存在しない場合は、空のキャッシュから開始
    }
    cache[key] = actionToCache;
    await fs.writeFile("cache.json", JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error(chalk.red("キャッシュへの保存に失敗しました:"), error);
  }
}

/**
 * `cache.json`から指示に対応するキャッシュ済みアクションを読み込みます。
 * @param page - 現在のPageオブジェクト。
 * @param instruction - 検索する指示。
 * @returns キャッシュされた`ObserveResult`オブジェクト。見つからない場合はnull。
 */
export async function readCache(
  page: Page,
  instruction: string,
): Promise<ObserveResult | null> {
  const key = getCacheKey(page.url(), instruction);
  try {
    const existingCache = await fs.readFile("cache.json", "utf-8");
    const cache: Record<string, ObserveResult> = JSON.parse(existingCache);
    return cache[key] || null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // ファイルが存在しない、または読み込めない場合はキャッシュなしとみなす
    return null;
  }
}

/**
 * キャッシュを利用して`act`操作を実行します。
 * 1. まずキャッシュからアクションを検索します。
 * 2. キャッシュにあれば、それを使って即座に実行します。
 * 3. なければ、`observe`を実行してアクションを決定し、結果をキャッシュに保存してから実行します。
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
    await page.act(cachedAction);
    return;
  }

  const results = await page.observe(instruction);
  console.log(chalk.blue("Observe結果:"), results);

  if (results.length === 0) {
    throw new Error(
      `キャッシュ用の要素が見つかりませんでした: "${instruction}"`,
    );
  }

  const actionToCache = results[0];
  console.log(chalk.blue("アクションをキャッシュします:"), actionToCache);
  await simpleCache(page, instruction, actionToCache);

  // ユーザーにどの要素が対象か視覚的にフィードバック
  await drawObserveOverlay(page, results);
  await page.waitForTimeout(overlayDuration);
  await clearOverlays(page);

  await page.act(actionToCache);
}
