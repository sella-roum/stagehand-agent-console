/**
 * @file `summarize`ツールを定義します。
 * 現在のページ内容や指定されたテキストを要約する機能を提供します。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";
import { LanguageModel } from "ai";
import { CustomTool } from "@/src/types";
import { generateTextWithRetry } from "@/src/utils/llm";

/**
 * `summarize`ツールの入力スキーマ。
 */
export const summarizeSchema = z.object({
  textToSummarize: z
    .string()
    .optional()
    .describe(
      "要約するテキスト。省略された場合、現在のページ全体のテキストを対象とします。",
    ),
});

/**
 * `summarize`ツールの定義オブジェクト。
 */
export const summarizeTool: CustomTool<typeof summarizeSchema, string> = {
  name: "summarize",
  description: "現在のページ内容や指定されたテキストを要約します。",
  schema: summarizeSchema,
  /**
   * `summarize`ツールを実行します。
   * 引数でテキストが与えられればそれを、なければ現在のページ全体を要約します。
   * @param state - 現在のエージェントの状態。
   * @param args - `summarizeSchema`に基づいた引数。
   * @param args.textToSummarize
   * @param llm - 要約に使用する言語モデルのインスタンス。
   * @param initialTask - (未使用でもシグネチャに含める)
   * @returns 要約されたテキスト。
   */
  execute: async (
    state: AgentState,
    { textToSummarize }: z.infer<typeof summarizeSchema>,
    llm: LanguageModel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    initialTask: string,
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

    // LLMにテキストの要約を依頼
    const { text } = await generateTextWithRetry({
      model: llm,
      prompt: `以下のテキストを日本語で簡潔に要約してください:\n\n${targetText.substring(0, 4000)}`, // 長すぎるテキストを切り詰める
    });
    return text;
  },
};
