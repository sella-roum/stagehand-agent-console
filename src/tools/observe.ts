/**
 * @file `observe`ツールを定義します。
 * このツールは、Stagehandの`page.observe()`メソッドをラップし、
 * ページ上の操作可能な要素を探索します。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";
import { drawObserveOverlay, clearOverlays } from "@/src/utils/ui";
import { CustomTool } from "@/src/types";

/**
 * `observe`ツールの入力スキーマ。
 */
export const observeSchema = z.object({
  instruction: z
    .string()
    .optional()
    .describe(
      "探したい要素の説明。例: 'すべてのボタン'。引数がない場合はページ上の主要な要素を観察します。",
    ),
});

/**
 * `observe`ツールの定義オブジェクト。
 */
export const observeTool: CustomTool<typeof observeSchema, any> = {
  name: "observe",
  description: "現在のページ上の操作可能な要素を探します。",
  schema: observeSchema,
  /**
   * `observe`ツールを実行します。
   * 発見された要素を一時的にハイライト表示し、ユーザーに視覚的なフィードバックを提供します。
   * @param state - 現在のエージェントの状態。
   * @param args - `observeSchema`に基づいた引数。
   * @param args.instruction
   * @returns 発見された要素のリスト（ObserveResult[]）。
   */
  execute: async (
    state: AgentState,
    { instruction }: z.infer<typeof observeSchema>,
  ) => {
    const page = state.getActivePage();
    const results = instruction
      ? await page.observe(instruction)
      : await page.observe();

    if (results.length > 0) {
      try {
        // ユーザーがどの要素が対象か視覚的に理解しやすくするためのオーバーレイ表示
        console.log("  ...観察対象をハイライト表示します。");
        await drawObserveOverlay(page, results);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // ユーザーが確認するための待機
      } finally {
        await clearOverlays(page);
      }
    }
    return results;
  },
};
