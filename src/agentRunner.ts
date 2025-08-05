/**
 * @file 非対話モードでAIエージェントのタスク実行を担う機能を提供します。
 * Playwrightのテストケースなど、自動化された環境からエージェントを呼び出すための
 * エントリーポイントとして機能します。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "@/src/agentState";
import { planSubgoals } from "@/src/chiefAgent";
import { taskAutomationAgent, getLlmInstance } from "@/src/taskAutomationAgent";
import { availableTools } from "@/src/tools";
import { AgentExecutionResult, CustomTool } from "@/src/types";
import { generateObject } from "ai";
import {
  progressEvaluationSchema,
  getProgressEvaluationPrompt,
} from "@/src/prompts/progressEvaluation";
import {
  getMemoryUpdatePrompt,
  memoryUpdateSchema,
} from "@/src/prompts/memory";

// テスト環境ではユーザーへの問い合わせができないため、`ask_user`ツールを無効化する
const testSafeTools: CustomTool[] = availableTools.filter(
  (t) => t.name !== "ask_user",
);
const testSafeToolRegistry = new Map<string, CustomTool>(
  testSafeTools.map((t) => [t.name, t]),
);

/**
 * エージェントの実行設定を定義するインターフェース。
 */
export interface AgentTaskConfig {
  /** 司令塔エージェントが生成できるサブゴールの最大数。デフォルトは10。 */
  maxSubgoals?: number;
  /** 各サブゴールで実行エージェントが試行できる最大ループ回数。デフォルトは15。 */
  maxLoopsPerSubgoal?: number;
}

/**
 * 非対話モードでAIエージェントのタスクを実行します。
 * この関数は、Playwrightのテストケース内など、ユーザーの介入なしで
 * エージェントの動作を検証する目的で使用されます。
 * @param task - ユーザーが与える高レベルなタスク文字列。
 * @param stagehand - 初期化済みのStagehandインスタンス。
 * @param config - エージェントの実行に関する設定オプション。
 * @returns タスクが成功した場合は、エージェントの自己評価を含む最終結果を返します。
 * @throws {Error} タスクの計画やサブゴールの実行に失敗した場合にエラーをスローします。
 */
export async function runAgentTask(
  task: string,
  stagehand: Stagehand,
  config: AgentTaskConfig = {},
): Promise<AgentExecutionResult> {
  const { maxSubgoals = 10, maxLoopsPerSubgoal = 15 } = config;
  const state = new AgentState(stagehand);
  const llm = getLlmInstance();

  // 1. 司令塔エージェントによる計画立案
  console.log(`👑 司令塔エージェントがタスク計画を開始: "${task}"`);
  let subgoals = await planSubgoals(task, llm);
  if (subgoals.length > maxSubgoals) {
    // 無限ループや意図しない長時間の実行を防ぐためのガードレール
    throw new Error(
      `計画されたサブゴールが多すぎます: ${subgoals.length} > ${maxSubgoals}`,
    );
  }
  const completedSubgoals: string[] = [];

  while (subgoals.length > 0) {
    const subgoal = subgoals.shift();
    if (!subgoal) continue;

    console.log(
      `\n▶️ サブゴール ${
        completedSubgoals.length + 1
      } 実行中: "${subgoal}"`,
    );
    const historyStartIndex = state.getHistory().length;

    try {
      const success = await taskAutomationAgent(subgoal, stagehand, state, task, {
        isTestEnvironment: true,
        maxLoops: maxLoopsPerSubgoal,
        tools: testSafeTools,
        toolRegistry: testSafeToolRegistry,
      });

      if (!success) {
        throw new Error(`サブゴール "${subgoal}" の実行に失敗しました。`);
      }
      completedSubgoals.push(subgoal);

      console.log("  ...🧠 経験を記憶に整理中 (非対話モード)...");
      const subgoalHistory = state.getHistory().slice(historyStartIndex);
      const subgoalHistoryJson = JSON.stringify(
        subgoalHistory.map((r) => ({
          toolName: r.toolCall.toolName,
          args: r.toolCall.args,
          result: r.result ? String(r.result).substring(0, 200) : "N/A",
        })),
      );

      try {
        const { object: memoryUpdate } = await generateObject({
          model: llm,
          prompt: getMemoryUpdatePrompt(task, subgoal, subgoalHistoryJson),
          schema: memoryUpdateSchema,
        });
        state.addToWorkingMemory(
          `直前のサブゴール「${subgoal}」の要約: ${memoryUpdate.subgoal_summary}`,
        );
        memoryUpdate.long_term_memory_facts.forEach((fact) =>
          state.addToLongTermMemory(fact),
        );
      } catch (e: any) {
        console.warn(
          `⚠️ 記憶の整理中にエラーが発生しました (非対話モード): ${e.message}`,
        );
      }

      console.log("🕵️‍♂️ タスク全体の進捗を評価中...");
      const historySummary = JSON.stringify(
        state
          .getHistory()
          .slice(-3)
          .map((record) => ({
            toolName: record.toolCall.toolName,
            args: record.toolCall.args,
            result:
              typeof record.result === "string"
                ? record.result.substring(0, 200)
                : record.result,
          })),
      );
      const currentUrl = state.getActivePage().url();
      const evalPrompt = getProgressEvaluationPrompt(
        task,
        historySummary,
        currentUrl,
      );

      const { object: progress } = await generateObject({
        model: llm,
        schema: progressEvaluationSchema,
        prompt: evalPrompt,
      });

      if (progress.isTaskCompleted) {
        console.log(
          `✅ タスクは既に完了したと判断しました。理由: ${progress.reasoning}`,
        );
        return {
          is_success: true,
          reasoning: progress.reasoning,
        };
      }
    } catch (error: any) {
      if (error.name === "ReplanNeededError") {
        console.warn(
          "🚨 再計画が必要です (非対話モード)。司令塔エージェントを呼び出します...",
        );
        const errorContext = JSON.stringify({
          name: error.originalError.name,
          message: error.originalError.message,
        });
        subgoals = await planSubgoals(task, llm, state, subgoal, errorContext);
        completedSubgoals.push(`${subgoal} (失敗)`);
        if (subgoals.length === 0) {
          throw new Error(
            "再計画の結果、実行可能なサブゴールがありません。タスク失敗とします。",
          );
        }
        continue;
      }
      throw error;
    }
  }

  const finalHistory = state.getHistory();
  const finishRecord = finalHistory.find(
    (h) => h.toolCall.toolName === "finish",
  );
  if (
    finishRecord &&
    typeof finishRecord.result === "string" &&
    finishRecord.result.startsWith("SELF_EVALUATION_COMPLETE:")
  ) {
    console.log("✅ 全てのサブゴールの処理が完了しました。");
    const resultJson = finishRecord.result.replace(
      "SELF_EVALUATION_COMPLETE: ",
      "",
    );
    return JSON.parse(resultJson);
  } else {
    throw new Error("エージェントはタスクを完了せずに終了しました。");
  }
}
