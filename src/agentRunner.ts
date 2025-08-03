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
  const subgoals = await planSubgoals(task, llm);
  if (subgoals.length > maxSubgoals) {
    // 無限ループや意図しない長時間の実行を防ぐためのガードレール
    throw new Error(
      `計画されたサブゴールが多すぎます: ${subgoals.length} > ${maxSubgoals}`,
    );
  }

  // 2. 各サブゴールの逐次実行
  for (const [index, subgoal] of subgoals.entries()) {
    console.log(
      `\n▶️ サブゴール ${index + 1}/${subgoals.length} 実行中: "${subgoal}"`,
    );

    const success = await taskAutomationAgent(subgoal, stagehand, state, task, {
      isTestEnvironment: true, // 非対話モードであることを実行エージェントに伝える
      maxLoops: maxLoopsPerSubgoal,
      tools: testSafeTools, // `ask_user`を除外したツールセットを使用
      toolRegistry: testSafeToolRegistry,
    });

    if (!success) {
      // サブゴールのいずれかが失敗した場合、タスク全体を失敗とみなし、即座にエラーをスローする
      throw new Error(`サブゴール "${subgoal}" の実行に失敗しました。`);
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
      // 早期終了した場合も、最終結果として評価を返す
      return {
        is_success: true,
        reasoning: progress.reasoning,
      };
    }
  }

  // 3. 最終結果の検証と返却
  const finalHistory = state.getHistory();
  // `finish`ツールが正常に呼び出され、自己評価が完了したかを確認
  const finishRecord = finalHistory.find(
    (h) => h.toolCall.toolName === "finish",
  );
  if (
    finishRecord &&
    typeof finishRecord.result === "string" &&
    finishRecord.result.startsWith("SELF_EVALUATION_COMPLETE:")
  ) {
    console.log("✅ 全てのサブゴールの処理が完了しました。");
    // `SELF_EVALUATION_COMPLETE: { ... }` という文字列からJSON部分を抽出してパースする
    const resultJson = finishRecord.result.replace(
      "SELF_EVALUATION_COMPLETE: ",
      "",
    );
    return JSON.parse(resultJson);
  } else {
    // `finish`ツールが呼ばれずにループが終了した場合、タスクは未完了とみなす
    throw new Error("エージェントはタスクを完了せずに終了しました。");
  }
}
