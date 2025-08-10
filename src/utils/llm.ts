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
 * @returns Vercel AI SDKの`LanguageModel`インスタンス。
 * @throws {Error} 必要なAPIキーが.envファイルに設定されていない場合にエラーをスローします。
 */
export function getLlmInstance(): LanguageModel {
  const agentMode = process.env.AGENT_MODE || "text";
  const LLM_PROVIDER = process.env.LLM_PROVIDER || "google";

  if (LLM_PROVIDER === "groq") {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey)
      throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
    const groq = createGroq({ apiKey: groqApiKey });
    // Groqは現在Vision非対応のため、モードに関わらずテキストモデルを使用
    return groq(process.env.GROQ_MODEL || "");
  } else if (LLM_PROVIDER === "openrouter") {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey)
      throw new Error("OPENROUTER_API_KEYが.envファイルに設定されていません。");
    const openrouter = createOpenAI({
      apiKey: openRouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Stagehand Agent Console",
      },
    });
    const modelName =
      agentMode === "vision"
        ? "" // Visionモードの場合、モデル名をOpenAIクライアントに任せる
        : process.env.OPENROUTER_MODEL || "";
    return openrouter(modelName);
  } else {
    // google
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey)
      throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    const modelName =
      agentMode === "vision"
        ? process.env.GEMINI_MODEL || "" // 現状のモデルは、すべて画像認識に対応しているため、このように記述
        : process.env.GEMINI_MODEL || "";
    return google(modelName);
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
