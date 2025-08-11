/**
 * @file エージェントの記憶管理に関するユーティリティ関数を提供します。
 */
import { AgentState } from "@/src/agentState";
import { LanguageModel } from "ai";
import {
  getMemoryUpdatePrompt,
  memoryUpdateSchema,
} from "@/src/prompts/memory";
import { generateObjectWithRetry } from "./llm";

/**
 * サブゴール完了後にエージェントの記憶を更新するための共通関数。
 * @param state - 現在のエージェントの状態。
 * @param llm - 記憶更新に使用する言語モデル。
 * @param originalTask - ユーザーが最初に与えた高レベルなタスク。
 * @param subgoal - 完了したサブゴール。
 * @param historyStartIndex - このサブゴールが開始された時点の履歴インデックス。
 * @param resultCharLimit - 履歴のresultフィールドを切り詰める文字数。
 */
export async function updateMemoryAfterSubgoal(
  state: AgentState,
  llm: LanguageModel,
  originalTask: string,
  subgoal: string,
  historyStartIndex: number,
  resultCharLimit: number = 200,
): Promise<void> {
  console.log("  ...🧠 経験を記憶に整理中...");
  const subgoalHistory = state.getHistory().slice(historyStartIndex);
  const subgoalHistoryJson = JSON.stringify(
    subgoalHistory.map((r) => ({
      toolName: r.toolCall.toolName,
      args:
        r.toolCall?.args != null
          ? (() => {
              try {
                return JSON.stringify(r.toolCall.args).substring(
                  0,
                  resultCharLimit,
                );
              } catch {
                return "[Unserializable args]";
              }
            })()
          : "N/A",
      result: r.result ? String(r.result).substring(0, resultCharLimit) : "N/A",
    })),
  );

  try {
    const { object: memoryUpdate } = await generateObjectWithRetry({
      model: llm,
      prompt: getMemoryUpdatePrompt(originalTask, subgoal, subgoalHistoryJson),
      schema: memoryUpdateSchema,
    });

    state.addToWorkingMemory(
      `直前のサブゴール「${subgoal}」の要約: ${memoryUpdate.subgoal_summary}`,
    );

    if (memoryUpdate.long_term_memory_facts.length > 0) {
      console.log("  ...📌 長期記憶に新しい事実を追加します。");
      memoryUpdate.long_term_memory_facts.forEach((fact: string) => {
        state.addToLongTermMemory(fact);
        console.log(`    - ${fact}`);
      });
    }
  } catch (e: any) {
    console.warn(`⚠️ 記憶の整理中にエラーが発生しました: ${e.message}`);
  }
}
