/**
 * @file `cached_act`ツールを定義します。
 * このツールは、`act`操作の結果をキャッシュすることで、繰り返し行われる操作を高速化します。
 */

import { z } from "zod";
import { AgentState } from "../agentState.js";
import { actWithCache } from "../../utils.js";

/**
 * `cached_act`ツールの入力スキーマ。
 */
export const cachedActSchema = z.object({
  instruction: z.string().describe("キャッシュを利用して実行する操作の自然言語指示。"),
});

/**
 * `cached_act`ツールの定義オブジェクト。
 */
export const cachedActTool = {
  name: "cached_act",
  description: "指示に対応する操作をキャッシュを利用して実行します。初めての操作は要素を探し、2回目以降は高速に実行します。",
  schema: cachedActSchema,
  /**
   * `cached_act`ツールを実行します。
   * `utils.ts`に定義されたキャッシュ機構を利用して操作を実行します。
   * @param state - 現在のエージェントの状態。
   * @param args - `cachedActSchema`に基づいた引数。
   * @returns 操作の実行成功メッセージ。
   */
  execute: async (state: AgentState, { instruction }: z.infer<typeof cachedActSchema>): Promise<string> => {
    const page = state.getActivePage();
    await actWithCache(page, instruction);
    return `キャッシュを利用して操作 '${instruction}' を実行しました。`;
  },
};
