/**
 * @file LLM関連のユーティリティ関数を提供します。
 * レートリミットエラーに対する指数バックオフ付きリトライ機能などを実装します。
 */
import { LanguageModel, generateText, generateObject, CoreMessage } from "ai";
import { z } from "zod";

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

/**
 * 指数バックオフ付きでgenerateTextを呼び出すラッパー関数。
 * @param options - generateTextに渡すオプション。
 * @returns generateTextの実行結果。
 * @throws リトライ上限に達した場合、またはレートリミット以外のエラーが発生した場合。
 */
export async function generateTextWithRetry(
  options: Parameters<typeof generateText>[0],
) {
  let lastError: any;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await generateText(options);
    } catch (error: any) {
      lastError = error;
      // HTTP 429 (Too Many Requests) エラーまたはメッセージ内容で判定
      if (
        error.response?.status === 429 ||
        error.message?.includes("Rate limit") ||
        error.message?.includes("rate limit")
      ) {
        const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, i);
        console.warn(
          `レートリミットエラーを検知しました。${
            backoffTime / 1000
          }秒後にリトライします... (${i + 1}/${MAX_RETRIES})`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
      } else {
        // レートリミット以外のエラーは即座にスロー
        throw error;
      }
    }
  }
  throw new Error(
    `LLM呼び出しが${MAX_RETRIES}回のリトライ後も失敗しました。最終エラー: ${lastError.message}`,
  );
}

/**
 * 指数バックオフ付きでgenerateObjectを呼び出すラッパー関数。
 * @param options - generateObjectに渡すオプション。
 * @param options.model
 * @param options.schema
 * @param options.messages
 * @param options.prompt
 * @returns generateObjectの実行結果。
 * @throws リトライ上限に達した場合、またはレートリミット以外のエラーが発生した場合。
 */
export async function generateObjectWithRetry<
  T extends z.ZodObject<any, any, any, any, any>,
>(options: {
  model: LanguageModel;
  schema: T;
  messages?: CoreMessage[];
  prompt?: string;
  [key: string]: any; // その他のオプショナルなプロパティを許容
}) {
  let lastError: any;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      // optionsをそのまま渡すことで、TypeScriptが正しく型を推論します
      return await generateObject(options);
    } catch (error: any) {
      lastError = error;
      // HTTP 429 (Too Many Requests) エラーまたはメッセージ内容で判定
      if (
        error.response?.status === 429 ||
        error.message?.includes("Rate limit") ||
        error.message?.includes("rate limit")
      ) {
        const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, i);
        console.warn(
          `レートリミットエラーを検知しました。${
            backoffTime / 1000
          }秒後にリトライします... (${i + 1}/${MAX_RETRIES})`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
      } else {
        // レートリミット以外のエラーは即座にスロー
        throw error;
      }
    }
  }
  throw new Error(
    `LLM呼び出しが${MAX_RETRIES}回のリトライ後も失敗しました。最終エラー: ${lastError.message}`,
  );
}
