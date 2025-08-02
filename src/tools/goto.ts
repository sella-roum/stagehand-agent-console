/**
 * @file `goto`ツールを定義します。
 * このツールは、Stagehandの`page.goto()`メソッドをラップし、
 * 指定されたURLへのページ遷移を実行します。
 */

import { z } from "zod";
import { AgentState } from "../agentState.js";

/**
 * `goto`ツールの入力スキーマ。
 */
export const gotoSchema = z.object({
  url: z.string().describe("移動先の完全なURL"),
});

/**
 * `goto`ツールの定義オブジェクト。
 */
export const gotoTool = {
  name: "goto",
  description: "指定されたURLに現在のブラウザタブを移動させます。ページのナビゲーションに使用します。",
  schema: gotoSchema,
  /**
   * `goto`ツールを実行します。
   * @param state - 現在のエージェントの状態。
   * @param args - `gotoSchema`に基づいた引数。
   * @returns ページ遷移の成功メッセージ。
   */
  execute: async (state: AgentState, { url }: z.infer<typeof gotoSchema>): Promise<string> => {
    const page = state.getActivePage();
    await page.goto(url);
    return `正常に ${url} に移動しました。`;
  },
};
