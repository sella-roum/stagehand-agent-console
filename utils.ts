import { ObserveResult, Page } from "@browserbasehq/stagehand";
import boxen from "boxen";
import chalk from "chalk";
import fs from "fs/promises";
import path from "node:path";
import { z } from "zod";

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
 * Get an environment variable and throw an error if it's not found
 * @param name - The name of the environment variable
 * @returns The value of the environment variable
 */
export function getEnvVar(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`${name} not found in environment variables`);
  }
  return value;
}

/**
 * Validate a Zod schema against some data
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @returns Whether the data is valid against the schema
 */
export function validateZodSchema(schema: z.ZodTypeAny, data: unknown) {
  try {
    schema.parse(data);
    return true;
  } catch {
    return false;
  }
}

export async function drawObserveOverlay(page: Page, results: ObserveResult[]) {
  // Convert single xpath to array for consistent handling
  const xpathList = results.map((result) => result.selector);

  // Filter out empty xpaths
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

export async function clearOverlays(page: Page) {
  // remove existing stagehandObserve attributes
  await page.evaluate(() => {
    const elements = document.querySelectorAll('[stagehandObserve="true"]');
    elements.forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent?.insertBefore(el.firstChild, el);
      }
      parent?.removeChild(el);
    });
  });
}

// --- キャッシュキー生成関数 ---
function getCacheKey(url: string, instruction: string): string {
  try {
    const urlObject = new URL(url);
    const key = `${urlObject.hostname}${urlObject.pathname} | ${instruction}`;
    return key;
  } catch (e) {
    // 無効なURL（例: about:blank）の場合は、指示のみをキーとする
    return instruction;
  }
}

export async function simpleCache(
  page: Page,
  instruction: string,
  actionToCache: ObserveResult,
) {
  const key = getCacheKey(page.url(), instruction);
  // Save action to cache.json
  try {
    // Read existing cache if it exists
    let cache: Record<string, ObserveResult> = {};
    try {
      const existingCache = await fs.readFile("cache.json", "utf-8");
      cache = JSON.parse(existingCache);
    } catch (error) {
      // File doesn't exist yet, use empty cache
    }

    // Add new action to cache
    cache[key] = actionToCache;

    // Write updated cache to file
    await fs.writeFile("cache.json", JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error(chalk.red("Failed to save to cache:"), error);
  }
}

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
    return null;
  }
}

/**
 * This function is used to act with a cacheable action.
 * It will first try to get the action from the cache.
 * If not in cache, it will observe the page and cache the result.
 * Then it will execute the action.
 * @param instruction - The instruction to act with.
 */
export async function actWithCache(
  page: Page,
  instruction: string,
): Promise<void> {
  // Try to get action from cache first
  const cachedAction = await readCache(page, instruction);
  if (cachedAction) {
    console.log(chalk.blue("Using cached action for:"), instruction);
    await page.act(cachedAction);
    return;
  }

  // If not in cache, observe the page and cache the result
  const results = await page.observe(instruction);
  console.log(chalk.blue("Got results:"), results);

  if (results.length === 0) {
    throw new Error(`キャッシュ用の要素が見つかりませんでした: "${instruction}"`);
  }

  // Cache the playwright action
  const actionToCache = results[0];
  console.log(chalk.blue("Taking cacheable action:"), actionToCache);
  await simpleCache(page, instruction, actionToCache);
  // OPTIONAL: Draw an overlay over the relevant xpaths
  await drawObserveOverlay(page, results);
  await page.waitForTimeout(1000); // Can delete this line, just a pause to see the overlay
  await clearOverlays(page);

  // Execute the action
  await page.act(actionToCache);
}

// --- 安全なファイルパスを取得・検証する関数 ---
export function getSafePath(filename: string): string {
    const workspaceDir = path.resolve(process.cwd(), 'workspace');
    const intendedPath = path.resolve(workspaceDir, filename);

    // パスがworkspaceディレクトリ内に収まっているか検証
    if (!intendedPath.startsWith(workspaceDir)) {
        throw new Error(`セキュリティエラー: ディレクトリトラバーサルが検出されました。ファイル操作は 'workspace' ディレクトリ内に限定されています。`);
    }
    
    // ディレクトリが存在しない場合は作成
    const dir = path.dirname(intendedPath);
    fs.mkdir(dir, { recursive: true });

    return intendedPath;
}
