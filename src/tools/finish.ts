/**
 * @file `finish`ツールを定義します。
 * このツールは、エージェントがタスク全体を完了したと判断した際に呼び出され、
 * 最終的な回答を報告し、自己評価を行います。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";
import {
  getEvaluationPrompt,
  evaluationSchema,
} from "@/src/prompts/evaluation";
import { LanguageModel, generateObject } from "ai";

/**
 * `finish`ツールの入力スキーマ。
 */
export const finishSchema = z.object({
  answer: z.string().describe("ユーザーの初期タスクに対する最終的な回答。"),
});

/**
 * `finish`ツールの定義オブジェクト。
 */
export const finishTool = {
  name: "finish",
  description:
    "全てのタスクが完了したと判断した場合に、最終的な回答をユーザーに報告して終了するために使用します。",
  schema: finishSchema,
  /**
   * `finish`ツールを実行します。
   * 最終回答を報告した後、LLMに自己評価を依頼し、その結果を返します。
   * @param state - 現在のエージェントの状態。
   * @param args - `finishSchema`に基づいた引数。
   * @param args.answer
   * @param llm - 自己評価に使用する言語モデルのインスタンス。
   * @param initialTask - ユーザーが最初に与えた高レベルなタスク。
   * @returns 自己評価の結果を含む特別な文字列。これにより、エージェントのループが終了します。
   */
  execute: async (
    state: AgentState,
    { answer }: z.infer<typeof finishSchema>,
    llm: LanguageModel,
    initialTask: string,
  ): Promise<string> => {
    console.log(
      `\n🏁 エージェントがタスク完了を報告しました。最終回答: ${answer}`,
    );
    console.log("  ...自己評価を実行中...");

    // 自己評価のために、直近の履歴を要約してコンテキストとして渡す
    const historySummary = JSON.stringify(state.getHistory().slice(-5));
    const evalPrompt = getEvaluationPrompt(initialTask, answer, historySummary);

    try {
      // LLMに自己評価を依頼
      const { object: evaluationResult } = await generateObject({
        model: llm,
        prompt: evalPrompt,
        schema: evaluationSchema,
      });

      console.log("\n--- 自己評価結果 ---");
      if (evaluationResult.is_success) {
        console.log("  ✅ 評価: 成功");
      } else {
        console.log("  ❌ 評価: 失敗");
      }
      console.log(`  理由: ${evaluationResult.reasoning}`);
      console.log("--------------------");

      // "finish"が呼ばれ、自己評価が完了したことを示す特別な文字列を返す
      // これにより、呼び出し元のエージェントループが正常に終了する
      return `SELF_EVALUATION_COMPLETE: ${JSON.stringify(evaluationResult)}`;
    } catch (error: any) {
      // スキーマ検証エラーなどのハンドリング
      if (error.name === "ZodError" || error.message.includes("schema")) {
        console.error(
          "❌ 自己評価の出力形式が不正です。スキーマ検証に失敗しました。",
        );
        // 失敗を示す特別なメッセージを返す
        return `SELF_EVALUATION_FAILED: スキーマ検証に失敗しました。最終回答: ${answer}`;
      }
      // その他の予期せぬエラー
      console.error("❌ 自己評価中に予期せぬエラーが発生しました:", error);
      return `SELF_EVALUATION_ERROR: ${error.message}。最終回答: ${answer}`;
    }
  },
};
