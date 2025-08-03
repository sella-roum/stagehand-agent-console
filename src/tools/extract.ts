/**
 * @file `extract`ツールを定義します。
 * このツールは、Stagehandの`page.extract()`メソッドをラップし、
 * ページから情報を抽出します。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";

/**
 * `extract`ツールの入力スキーマ。
 */
export const extractSchema = z.object({
  instruction: z
    .string()
    .nullable()
    .describe(
      "抽出したい内容の指示。例: '記事のタイトル'。引数がない場合はページ全体のテキストを抽出します。",
    ),
});

/**
 * `extract`ツールの定義オブジェクト。
 */
export const extractTool = {
  name: "extract",
  description: "現在のページから情報を抽出します。",
  schema: extractSchema,
  /**
   * `extract`ツールを実行します。
   * 指示があればその内容を、なければページ全体のテキストを抽出します。
   * @param state - 現在のエージェントの状態。
   * @param args - `extractSchema`に基づいた引数。
   * @param args.instruction
   * @returns 抽出された情報。
   */
  execute: async (
    state: AgentState,
    { instruction }: z.infer<typeof extractSchema>,
  ): Promise<any> => {
    const page = state.getActivePage();
    if (instruction) {
      return await page.extract(instruction);
    }
    // instructionがない場合は、ページ全体のテキストを抽出する
    return await page.extract();
  },
};
