/**
 * @file プロジェクト全体で利用される汎用的なユーティリティ関数を提供します。
 */

import { ObserveResult, Page } from "@browserbasehq/stagehand";
import boxen from "boxen";
import chalk from "chalk";
import fs from "fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * コンソールに目立つ枠線付きのメッセージを表示します。
 * @param message - 表示するメッセージ本文。
 * @param title - (オプション) 枠の上部に表示するタイトル。
 */
export function announce(message: string, title?: string) {
  console.log(
    boxen(message, {
      padding: 1,
      margin: 3,
      title: title || "Stagehand",
    }),
  );
}

/**
 * 環境変数を取得します。必須の変数が設定されていない場合はエラーをスローします。
 * @param name - 取得する環境変数の名前。
 * @param required - (オプション) この変数が必須かどうか。デフォルトはtrue。
 * @returns 環境変数の値。必須でない場合はundefinedの可能性があります。
 * @throws {Error} 必須の環境変数が設定されていない場合にエラーをスローします。
 */
export function getEnvVar(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`${name} not found in environment variables`);
  }
  return value;
}

/**
 * 与えられたデータがZodスキーマに準拠しているか検証します。
 * @param schema - 検証に使用するZodスキーマ。
 * @param data - 検証対象のデータ。
 * @returns データがスキーマに準拠していればtrue、そうでなければfalse。
 */
export function validateZodSchema(schema: z.ZodTypeAny, data: unknown) {
  try {
    schema.parse(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * `observe`の結果に基づき、ページ上の該当要素に視覚的なオーバーレイを描画します。
 * デバッグやユーザーへのフィードバックに利用します。
 * @param page - 操作対象のStagehand Pageオブジェクト。
 * @param results - `observe`コマンドから返された結果の配列。
 */
export async function drawObserveOverlay(page: Page, results: ObserveResult[]) {
  const xpathList = results.map((result) => result.selector);
  const validXpaths = xpathList.filter((xpath) => xpath !== "xpath=");

  await page.evaluate((selectors) => {
    selectors.forEach((selector) => {
      let element;
      if (selector.startsWith("xpath=")) {
        const xpath = selector.substring(6);
        element = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue;
      } else {
        element = document.querySelector(selector);
      }

      if (element instanceof HTMLElement) {
        const overlay = document.createElement("div");
        overlay.setAttribute("stagehandObserve", "true");
        const rect = element.getBoundingClientRect();
        overlay.style.position = "absolute";
        overlay.style.left = rect.left + "px";
        overlay.style.top = rect.top + "px";
        overlay.style.width = rect.width + "px";
        overlay.style.height = rect.height + "px";
        overlay.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "10000";
        document.body.appendChild(overlay);
      }
    });
  }, validXpaths);
}

/**
 * `drawObserveOverlay`によって描画されたすべてのオーバーレイをページから削除します。
 * @param page - 操作対象のStagehand Pageオブジェクト。
 */
export async function clearOverlays(page: Page) {
  await page.evaluate(() => {
    const elements = document.querySelectorAll('[stagehandObserve="true"]');
    elements.forEach((el) => {
      el.parentNode?.removeChild(el);
    });
  });
}

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
 * @throws {Error} `observe`で操作対象の要素が見つからなかった場合にエラーをスローします。
 */
export async function actWithCache(
  page: Page,
  instruction: string,
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
    throw new Error(`キャッシュ用の要素が見つかりませんでした: "${instruction}"`);
  }

  const actionToCache = results[0];
  console.log(chalk.blue("アクションをキャッシュします:"), actionToCache);
  await simpleCache(page, instruction, actionToCache);
  
  // ユーザーにどの要素が対象か視覚的にフィードバック
  await drawObserveOverlay(page, results);
  await page.waitForTimeout(1000);
  await clearOverlays(page);

  await page.act(actionToCache);
}

/**
 * 安全なファイルパスを取得し、ディレクトリトラバーサル攻撃を防ぎます。
 * ファイルパスが`workspace`ディレクトリ内に収まっていることを保証します。
 * @param filename - 操作対象のファイル名。
 * @returns `workspace`ディレクトリをルートとする絶対パス。
 * @throws {Error} パスが`workspace`ディレクトリ外を指している場合にセキュリティエラーをスローします。
 */
export function getSafePath(filename: string): string {
    const workspaceDir = path.resolve(process.cwd(), 'workspace');
    const intendedPath = path.resolve(workspaceDir, filename);

    // パスがworkspaceディレクトリ内に収まっているか検証
    if (!intendedPath.startsWith(workspaceDir)) {
        throw new Error(`セキュリティエラー: ディレクトリトラバーサルが検出されました。ファイル操作は 'workspace' ディレクトリ内に限定されています。`);
    }
    
    // ファイルが配置されるディレクトリが存在しない場合は再帰的に作成
    const dir = path.dirname(intendedPath);
    fs.mkdir(dir, { recursive: true });

    return intendedPath;
}
