/**
 * @file AIエージェントのタスク実行フロー全体を統括するOrchestratorを提供します。
 * 計画、実行、進捗評価、再計画のループを管理する中心的なロジックです。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "@/src/agentState";
import { planMilestones } from "@/src/chiefAgent";
import { subgoalCoordinator } from "@/src/subgoalCoordinator";
import {
  AgentExecutionResult,
  CustomTool,
  ApprovalCallback,
  Milestone,
  ReplanNeededError,
} from "@/src/types";
import { z } from "zod";
import { getLlmInstance } from "@/src/utils/llm";

/**
 * エージェントの実行設定
 */
export interface OrchestratorConfig<TArgs = unknown> {
  /** @deprecated マイルストーン計画に移行したため、この設定は将来的に削除されます。 */
  maxSubgoals?: number;
  /** 各サブゴールで実行エージェントが試行できる最大ループ回数。 */
  maxLoopsPerSubgoal?: number;
  /** 司令塔エージェントが再計画を試行できる最大回数。 */
  maxReplanAttempts?: number;
  /** テスト環境で実行されているかどうか。 */
  isTestEnvironment?: boolean;
  /** エージェントが利用可能なツールのリスト。 */
  tools?: CustomTool<z.AnyZodObject, TArgs>[];
  /** ツール名で高速に検索するためのMap。 */
  toolRegistry?: Map<string, CustomTool<z.AnyZodObject, TArgs>>;
  /** ユーザーに計画の承認を求めるためのコールバック関数。 */
  approvalCallback: ApprovalCallback<TArgs>;
}

/**
 * エージェントのタスク実行フロー全体を統括します。
 * @param task - ユーザーが与える高レベルなタスク文字列。
 * @param stagehand - 初期化済みのStagehandインスタンス。
 * @param state - エージェントの状態を管理するインスタンス。
 * @param config - 実行に関する設定オプション。
 * @returns タスクの最終結果。
 * @throws タスク実行中に解決不能なエラーが発生した場合。
 */
export async function orchestrateAgentTask<TArgs = unknown>(
  task: string,
  stagehand: Stagehand,
  state: AgentState,
  config: OrchestratorConfig<TArgs>,
): Promise<AgentExecutionResult> {
  const { maxReplanAttempts = 3, approvalCallback } = config;

  const highPerformanceLlm = getLlmInstance("default");
  const fastLlm = getLlmInstance("fast");
  const llms = { highPerformance: highPerformanceLlm, fast: fastLlm };

  console.log(`👑 司令塔エージェントがタスク計画を開始: "${task}"`);
  let milestones: Milestone[] = await planMilestones(
    task,
    llms.highPerformance,
  );

  const completedMilestones: string[] = [];
  let replanCount = 0;

  while (milestones.length > 0) {
    const milestone = milestones.shift();
    if (!milestone) continue;

    console.log(
      `\n🏁 マイルストーン ${completedMilestones.length + 1} 実行中: "${
        milestone.description
      }"`,
    );

    try {
      const success = await subgoalCoordinator(
        milestone,
        stagehand,
        state,
        task,
        llms,
        { ...config, approvalCallback },
      );

      if (!success) {
        throw new ReplanNeededError(
          `マイルストーン "${milestone.description}" の実行に失敗しました。`,
          new Error(`Milestone execution failed: ${milestone.description}`),
          {
            toolCallId: `milestone-${milestone.description.replace(/\s/g, "_")}-failed`,
            toolName: "milestone_coordination",
            args: { milestone: milestone.description },
          },
        );
      }
      completedMilestones.push(milestone.description);
      replanCount = 0; // 成功したらリセット
    } catch (error: any) {
      if (error instanceof ReplanNeededError) {
        if (replanCount >= maxReplanAttempts) {
          throw new Error(
            `再計画の試行回数が上限（${maxReplanAttempts}回）に達しました。タスクの自動実行を中止します。`,
          );
        }
        replanCount++;

        console.warn(
          `🚨 再計画が必要です (${replanCount}/${maxReplanAttempts})。司令塔エージェントを呼び出します...`,
        );

        const failedSubgoalForReplan = {
          description: milestone.description,
          successCriteria: milestone.completionCriteria,
        };

        const newMilestones = await planMilestones(
          task,
          llms.highPerformance,
          state,
          failedSubgoalForReplan,
          error.originalError.message,
          error.failureContext,
        );

        if (
          newMilestones.length === 1 &&
          (newMilestones[0].description
            .toLowerCase()
            .includes("タスクを中止") ||
            newMilestones[0].description.toLowerCase().includes("達成不可能") ||
            /^finish:/i.test(newMilestones[0].description))
        ) {
          const reasoning = newMilestones[0].completionCriteria;
          console.log(
            `👑 司令塔エージェントがタスクの中止を決定しました。理由: ${reasoning}`,
          );
          return { is_success: false, reasoning };
        }

        milestones = newMilestones;
        completedMilestones.push(`${milestone.description} (失敗から再計画)`);
        continue;
      }
      throw error;
    }
  }

  const finalHistory = state.getHistory();
  const finishRecord = finalHistory.find(
    (h) => h.toolCall?.toolName === "finish",
  );
  if (
    finishRecord &&
    typeof finishRecord.result === "string" &&
    finishRecord.result.startsWith("SELF_EVALUATION_COMPLETE:")
  ) {
    const PREFIX = "SELF_EVALUATION_COMPLETE:";
    const payload = finishRecord.result.slice(PREFIX.length).trimStart();
    return JSON.parse(payload);
  } else {
    console.log(
      "✅ 全てのマイルストーンが完了しましたが、finishツールは呼び出されませんでした。タスク成功とみなします。",
    );
    return {
      is_success: true,
      reasoning: "全ての計画されたマイルストーンを正常に完了しました。",
    };
  }
}
