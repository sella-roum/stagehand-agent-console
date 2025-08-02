/**
 * @file StagehandおよびAIエージェントの全体的な設定を管理します。
 * このファイルは、使用するLLMプロバイダ、モデル、ブラウザ環境などを
 * 環境変数に基づいて動的に設定します。
 */

import type { ConstructorParams } from "@browserbasehq/stagehand";
import dotenv from "dotenv";

// .envファイルから環境変数を読み込む
dotenv.config();

// 環境変数から使用するLLMプロバイダを選択 (デフォルトは'google')
const LLM_PROVIDER = process.env.LLM_PROVIDER || "google";

let modelName: string;
let modelClientOptions: {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

// プロバイダに応じてモデル名とクライアントオプションを動的に設定
if (LLM_PROVIDER === "groq") {
  console.log("🚀 Using Groq Cloud API");
  modelName = `groq/${process.env.GROQ_MODEL || ""}`; // デフォルトモデルを更新
  modelClientOptions = { apiKey: process.env.GROQ_API_KEY };
} else if (LLM_PROVIDER === "openrouter") {
  console.log("🚀 Using OpenRouter API");
  modelName = `${process.env.OPENROUTER_MODEL || ""}`; // デフォルトモデルを設定
  modelClientOptions = {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    // OpenRouterの利用規約に基づき、識別用のヘッダーを追加
    headers: {
      "HTTP-Referer": "http://localhost:3000", // 開発元を示すURL
      "X-Title": "Stagehand Agent Console", // プロジェクト名
    },
  };
} else {
  console.log("🚀 Using Google Gemini API");
  modelName = `google/${process.env.GEMINI_MODEL || ""}`; // デフォルトモデルを更新
  modelClientOptions = { apiKey: process.env.GOOGLE_API_KEY };
}

/**
 * Stagehandのコンストラクタに渡すための設定オブジェクト。
 */
const StagehandConfig: ConstructorParams = {
  /** ログの詳細度レベル: 0 = サイレント, 1 = 情報, 2 = すべて */
  verbose: 1,
  /** DOMが安定するのを待つ最大時間 (ミリ秒) */
  domSettleTimeoutMs: 30_000,

  // --- LLM Configuration ---
  /** 使用するLLMのモデル名 */
  modelName: modelName,
  /** LLMクライアントに渡す設定オプション (APIキーなど) */
  modelClientOptions,

  // --- Browser Configuration ---
  /** 実行環境: 'LOCAL' または 'BROWSERBASE' */
  env: "LOCAL",
  /** BrowserbaseのAPIキー (BROWSERBASE環境で使用) */
  apiKey: process.env.BROWSERBASE_API_KEY,
  /** BrowserbaseのプロジェクトID (BROWSERBASE環境で使用) */
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  /** 再開するBrowserbaseセッションのID */
  browserbaseSessionID: undefined,
  /** 新しいBrowserbaseセッションを作成する際の設定 */
  browserbaseSessionCreateParams: {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      blockAds: true,
      viewport: {
        width: 1280,
        height: 720,
      },
    },
  },
  /** ローカルブラウザを起動する際の設定 */
  localBrowserLaunchOptions: {
    headless: false, // `false`にするとブラウザUIが表示される
    viewport: {
      width: 1280,
      height: 720,
    },
  },
};

export default StagehandConfig;
