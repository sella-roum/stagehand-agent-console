/**
 * @file `goto`ツールを定義します。
 * このツールは、Stagehandの`page.goto()`メソッドをラップし、
 * 指定されたURLへのページ遷移を実行します。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";
import { NavigationTimeoutError } from "@/src/errors";

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
  description:
    "指定されたURLに現在のブラウザタブを移動させます。ページのナビゲーションに使用します。",
  schema: gotoSchema,
  /**
   * `goto`ツールを実行します。
   * @param state - 現在のエージェントの状態。
   * @param args - `gotoSchema`に基づいた引数。
   * @param args.url
   * @returns ページ遷移の成功メッセージ。
   */
  execute: async (
    state: AgentState,
    args: z.infer<typeof gotoSchema>,
  ): Promise<string> => {
    const { url } = args;
    const page = state.getActivePage();
    try {
      await page.goto(url);
      return `正常に ${url} に移動しました。`;
    } catch (error: any) {
      if (error.name === "TimeoutError") {
        throw new NavigationTimeoutError(
          `URLへの移動がタイムアウトしました: ${url}。URLが正しいか、またはネットワークに問題がないか確認してください。`,
          "goto",
          args,
          url,
        );
      }
      throw error;
    }
  },
};
