/**
 * @file `summarize`ツールを定義します。
 * 現在のページ内容や指定されたテキストを要約する機能を提供します。
 */

import { z } from "zod";
import { AgentState } from "../agentState.js";
import { LanguageModel, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";

/**
 * `summarize`ツールの入力スキーマ。
 */
export const summarizeSchema = z.object({
  textToSummarize: z
    .string()
    .nullable()
    .describe(
      "要約するテキスト。nullの場合、現在のページ全体のテキストを対象とします。",
    ),
});

/**
 * `summarize`ツールの定義オブジェクト。
 */
export const summarizeTool = {
  name: "summarize",
  description: "現在のページ内容や指定されたテキストを要約します。",
  schema: summarizeSchema,
  /**
   * `summarize`ツールを実行します。
   * 引数でテキストが与えられればそれを、なければ現在のページ全体を要約します。
   * @param state - 現在のエージェントの状態。
   * @param args - `summarizeSchema`に基づいた引数。
   * @param args.textToSummarize
   * @returns 要約されたテキスト。
   */
  execute: async (
    state: AgentState,
    { textToSummarize }: z.infer<typeof summarizeSchema>,
  ): Promise<string> => {
    let targetText = textToSummarize;
    // 要約対象のテキストが指定されていない場合、現在のページ全体を抽出する
    if (!targetText) {
      const page = state.getActivePage();
      const extraction = await page.extract();
      targetText = extraction?.page_text || "";
    }

    if (!targetText) {
      return "要約対象のテキストがありません。";
    }

    // このツール内で独立してLLMインスタンスを生成する
    // 注意: この実装はtaskAutomationAgent.ts内のロジックと重複しているため、将来的には共通化が望ましい
    const LLM_PROVIDER = process.env.LLM_PROVIDER || "google";
    let llm: LanguageModel;
    if (LLM_PROVIDER === "groq") {
      const groqApiKey = process.env.GROQ_API_KEY;
      if (!groqApiKey)
        throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
      const groq = createGroq({ apiKey: groqApiKey });
      llm = groq(process.env.GROQ_MODEL || "");
    } else if (LLM_PROVIDER === "openrouter") {
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterApiKey)
        throw new Error(
          "OPENROUTER_API_KEYが.envファイルに設定されていません。",
        );
      const openrouter = createOpenAI({
        apiKey: openRouterApiKey,
        baseURL: "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Stagehand Agent Console",
        },
      });
      llm = openrouter(process.env.OPENROUTER_MODEL || "");
    } else {
      const googleApiKey = process.env.GOOGLE_API_KEY;
      if (!googleApiKey)
        throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
      const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
      llm = google(process.env.GEMINI_MODEL || "");
    }

    // LLMにテキストの要約を依頼
    const { text } = await generateText({
      model: llm,
      prompt: `以下のテキストを日本語で簡潔に要約してください:\n\n${targetText.substring(0, 4000)}`, // 長すぎるテキストを切り詰める
    });
    return text;
  },
};
