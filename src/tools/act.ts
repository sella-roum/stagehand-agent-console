/**
 * @file `act`ツールを定義します。
 * このツールは、Stagehandの`page.act()`メソッドをラップし、
 * 自然言語によるブラウザ操作を実行します。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";
import { drawObserveOverlay, clearOverlays } from "@/src/utils/ui";
import { ElementNotFoundError } from "@/src/errors";
import { CustomTool } from "@/src/types";

/**
 * `act`ツールの入力スキーマ。
 * `instruction`には実行したい操作を自然言語で記述します。
 */
export const actSchema = z.object({
  instruction: z
    .string()
    .describe(
      "実行する操作の自然言語による指示。例: '「ログイン」ボタンをクリック'",
    ),
});

/**
 * `act`ツールの定義オブジェクト。
 */
export const actTool: CustomTool<typeof actSchema> = {
  name: "act",
  description:
    "ページ上で特定の操作（クリック、入力、スクロールなど）を行います。",
  schema: actSchema,
  /**
   * `act`ツールを実行します。
   * 内部ではまず`observe`を試み、対象要素を特定してから`act`を実行することで、
   * 操作の信頼性を高めています。
   * @param state - 現在のエージェントの状態。
   * @param args - `actSchema`に基づいた引数。
   * @returns 操作の実行結果を示す文字列。
   */
  execute: async (
    state: AgentState,
    args: z.infer<typeof actSchema>,
  ): Promise<string> => {
    const { instruction } = args;
    const page = state.getActivePage();

    try {
      // まず`observe`で操作対象の要素を特定する
      const observedForAct = await page.observe(instruction);

      if (observedForAct.length > 0) {
        // 要素が見つかった場合、ユーザーに視覚的なフィードバックを提供
        console.log("  ...操作対象をハイライト表示します。");
        await drawObserveOverlay(page, observedForAct);
        await new Promise((resolve) => setTimeout(resolve, 1500)); // ユーザーが確認するための短い待機

        // 最も確からしい要素に対して操作を実行
        const result = await page.act(observedForAct[0]);
        await clearOverlays(page);
        return `操作 '${instruction}' を実行しました。結果: ${JSON.stringify(
          result,
        )}`;
      } else {
        // `observe`で要素が見つからなかった場合、`act`に直接指示を渡してフォールバック
        console.log("  ...observeで見つからなかったため、直接actを試みます。");
        const result = await page.act(instruction);
        return `操作 '${instruction}' を直接実行しました。結果: ${JSON.stringify(
          result,
        )}`;
      }
    } catch (error) {
      // エラー判定の堅牢性を向上
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.message?.includes("timeout"))
      ) {
        // 構造化されたエラー情報を持つカスタムエラーをスローする
        throw new ElementNotFoundError(
          `要素の操作がタイムアウトしました: ${error.message}`,
          "act",
          args,
          instruction,
        );
      }
      // その他の予期せぬエラーはそのまま再スロー
      throw error;
    }
  },
};
