/**
 * @file LLM関連のユーティリティ関数を提供します。
 * レートリミットエラーに対する指数バックオフ付きリトライ機能などを実装します。
 */
import { LanguageModel, generateText, generateObject, CoreMessage } from "ai";
import { z } from "zod";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

/**
 * 環境変数に基づいて、適切なLLMクライアントのインスタンスを生成して返します。
 * @param role - モデルの役割 ('default' for high-performance, 'fast' for speed/low-cost)。
 * @returns Vercel AI SDKの`LanguageModel`インスタンス。
 * @throws {Error} 必要なAPIキーやモデル名が.envファイルに設定されていない場合にエラーをスローします。
 */
export function getLlmInstance(
  role: "default" | "fast" = "default",
): LanguageModel {
  const provider = process.env.LLM_PROVIDER?.toLowerCase() || "google";

  const getModelName = (providerName: string): string => {
    const modelEnvVar = `${providerName.toUpperCase()}_${role.toUpperCase()}_MODEL`;
    const modelName = process.env[modelEnvVar];
    if (!modelName) {
      throw new Error(
        `環境変数 ${modelEnvVar} が.envファイルに設定されていません。`,
      );
    }
    return modelName;
  };

  switch (provider) {
    case "google": {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey)
        throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
      const google = createGoogleGenerativeAI({ apiKey });
      const modelName = getModelName("google");
      return google(modelName);
    }
    case "groq": {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey)
        throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
      const groq = createGroq({ apiKey });
      const modelName = getModelName("groq");
      return groq(modelName);
    }
    case "openrouter": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey)
        throw new Error(
          "OPENROUTER_API_KEYが.envファイルに設定されていません。",
        );
      const openrouter = createOpenAI({
        apiKey: apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer":
            process.env.OPENROUTER_HTTP_REFERER || "http://localhost:3000",
          "X-Title":
            process.env.OPENROUTER_X_TITLE || "Stagehand Agent Console",
        },
      });
      const modelName = getModelName("openrouter");
      return openrouter(modelName);
    }
    default:
      throw new Error(
        `サポートされていないLLMプロバイダです: "${provider}"。'google', 'groq', 'openrouter'のいずれかを指定してください。`,
      );
  }
}

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
        error.status === 429 ||
        error.code === "rate_limit_exceeded" ||
        error.message?.toLowerCase().includes("rate limit") ||
        error.message?.toLowerCase().includes("quota exceeded") ||
        error.message?.toLowerCase().includes("too many requests")
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
  [key: string]: any;
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
        error.status === 429 ||
        error.code === "rate_limit_exceeded" ||
        error.message?.toLowerCase().includes("rate limit") ||
        error.message?.toLowerCase().includes("quota exceeded") ||
        error.message?.toLowerCase().includes("too many requests")
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
