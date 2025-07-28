import type { ConstructorParams } from "@browserbasehq/stagehand";
import dotenv from "dotenv";

dotenv.config();

// 環境変数から使用するLLMプロバイダを選択 (デフォルトはgoogle)
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';

let modelName: string;
let modelClientOptions: { apiKey?: string };

// プロバイダに応じて設定を切り替え
if (LLM_PROVIDER === 'groq') {
  console.log("🚀 Using Groq Cloud API");
  modelName = `groq/${process.env.GROQ_MODEL || 'llama3-70b-8192'}`;
  modelClientOptions = { apiKey: process.env.GROQ_API_KEY };
} else {
  console.log("🚀 Using Google Gemini API");
  modelName = `google/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`;
  modelClientOptions = { apiKey: process.env.GOOGLE_API_KEY };
}

const StagehandConfig: ConstructorParams = {
  verbose: 1 /* Verbosity level for logging: 0 = silent, 1 = info, 2 = all */,
  domSettleTimeoutMs: 30_000 /* Timeout for DOM to settle in milliseconds */,

  // LLM configuration
  modelName: modelName /* Name of the model to use */,
  modelClientOptions /* Configuration options for the model client */,

  // Browser configuration
  env: "LOCAL" /* Environment to run in: LOCAL or BROWSERBASE */,
  apiKey: process.env.BROWSERBASE_API_KEY /* API key for authentication */,
  projectId: process.env.BROWSERBASE_PROJECT_ID /* Project identifier */,
  browserbaseSessionID:
    undefined /* Session ID for resuming Browserbase sessions */,
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
  localBrowserLaunchOptions: {
    headless: false,
    viewport: {
      width: 1280,
      height: 720,
    },
  } /* Configuration options for the local browser */,
};

export default StagehandConfig;
