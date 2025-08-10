/**
 * @file AIエージェントのタスク実行フロー全体を統括するOrchestratorを提供します。
 * 計画、実行、進捗評価、再計画のループを管理する中心的なロジックです。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "@/src/agentState";
import { planSubgoals } from "@/src/chiefAgent";
import { taskAutomationAgent } from "@/src/taskAutomationAgent";
import {
  AgentExecutionResult,
  CustomTool,
  ApprovalCallback,
} from "@/src/types";
import { LanguageModel } from "ai";
import { generateObjectWithRetry } from "@/src/utils/llm";
import {
  progressEvaluationSchema,
  getProgressEvaluationPrompt,
} from "@/src/prompts/progressEvaluation";
import { updateMemoryAfterSubgoal } from "@/src/utils/memory";
import { z } from "zod";

/**
 * エージェントの実行設定
 */
export interface OrchestratorConfig<TArgs = unknown> {
  maxSubgoals?: number;
  maxLoopsPerSubgoal?: number;
  maxReplanAttempts?: number;
  isTestEnvironment?: boolean;
  tools?: CustomTool<z.AnyZodObject, TArgs>[];
  toolRegistry?: Map<string, CustomTool<z.AnyZodObject, TArgs>>;
  approvalCallback: ApprovalCallback<TArgs>;
}

/**
 * エージェントのタスク実行フロー全体を統括します。
 * @param task - ユーザーが与える高レベルなタスク文字列。
 * @param stagehand - 初期化済みのStagehandインスタンス。
 * @param state - エージェントの状態を管理するインスタンス。
 * @param llm - 使用する言語モデルのインスタンス。
 * @param config - 実行に関する設定オプション。
 * @returns タスクの最終結果。
 * @throws タスク実行中に解決不能なエラーが発生した場合。
 */
export async function orchestrateAgentTask<TArgs = unknown>(
  task: string,
  stagehand: Stagehand,
  state: AgentState,
  llm: LanguageModel,
  config: OrchestratorConfig<TArgs>,
): Promise<AgentExecutionResult> {
  const {
    maxSubgoals = 10,
    maxLoopsPerSubgoal = 15,
    maxReplanAttempts = 3,
    approvalCallback,
  } = config;

  // 1. 計画
  console.log(`👑 司令塔エージェントがタスク計画を開始: "${task}"`);
  let subgoals = await planSubgoals(task, llm);
  if (subgoals.length > maxSubgoals) {
    console.warn(
      `計画されたサブゴールが多すぎます: ${subgoals.length} > ${maxSubgoals}。先頭${maxSubgoals}件に制限します。`,
    );
    subgoals = subgoals.slice(0, maxSubgoals);
  }

  const completedSubgoals: string[] = [];
  let replanCount = 0;

  // 2. サブゴール実行ループ
  while (subgoals.length > 0) {
    const subgoal = subgoals.shift();
    if (!subgoal) continue;

    console.log(
      `\n▶️ サブゴール ${completedSubgoals.length + 1} 実行中: "${subgoal}"`,
    );
    const historyStartIndex = state.getHistory().length;

    try {
      // 2a. サブゴール実行
      const success = await taskAutomationAgent(
        subgoal,
        stagehand,
        state,
        task,
        llm,
        {
          ...config,
          maxLoops: maxLoopsPerSubgoal,
          approvalCallback,
        },
      );

      if (!success) {
        throw new Error(`サブゴール "${subgoal}" の実行に失敗しました。`);
      }
      completedSubgoals.push(subgoal);
      // 成功後は再計画リトライ回数をリセット
      replanCount = 0;

      // 2b. 記憶の更新（失敗しても全体は継続）
      try {
        await updateMemoryAfterSubgoal(
          state,
          llm,
          task,
          subgoal,
          historyStartIndex,
          200,
        );
      } catch (e: any) {
        console.warn(
          `メモリ更新に失敗しました（継続します）: ${e?.message ?? e}`,
        );
      }

      // 2c. 進捗評価
      console.log("🕵️‍♂️ タスク全体の進捗を評価中...");
      const historySummary = JSON.stringify(state.getHistory().slice(-3));
      let currentUrl = "about:blank";
      try {
        currentUrl = state.getActivePage().url();
      } catch {
        // ページが無い/取得失敗時は既定値
      }
      const evalPrompt = getProgressEvaluationPrompt(
        task,
        historySummary,
        currentUrl,
      );

      const { object: progress } = await generateObjectWithRetry({
        model: llm,
        schema: progressEvaluationSchema,
        prompt: evalPrompt,
      });

      if (progress.isTaskCompleted) {
        console.log(
          `✅ タスクは既に完了したと判断しました。理由: ${progress.reasoning}`,
        );
        return { is_success: true, reasoning: progress.reasoning };
      }
    } catch (error: any) {
      // 2d. 再計画処理
      if (error.name === "ReplanNeededError") {
        if (replanCount >= maxReplanAttempts) {
          throw new Error(
            `再計画の試行回数が上限（${maxReplanAttempts}回）に達しました。タスクの自動実行を中止します。`,
          );
        }
        replanCount++;

        console.warn(
          `🚨 再計画が必要です (${replanCount}/${maxReplanAttempts})。司令塔エージェントを呼び出します...`,
        );
        const errorContext = JSON.stringify({
          name: error.originalError?.name ?? error.name,
          message: error.originalError?.message ?? error.message,
          failedTool: error.failedToolCall
            ? {
                name: error.failedToolCall.toolName,
                args: error.failedToolCall.args,
              }
            : undefined,
        });
        subgoals = await planSubgoals(task, llm, state, subgoal, errorContext);
        completedSubgoals.push(`${subgoal} (失敗)`);
        if (subgoals.length === 0) {
          throw new Error("再計画の結果、実行可能なサブゴールがありません。");
        }
        continue; // 次のループ（新しい計画）へ
      }
      throw error; // 解決不能なエラーは再スロー
    }
  }

  // 3. 最終結果の取得
  const finalHistory = state.getHistory();
  const finishRecord = finalHistory.find(
    (h) => h.toolCall?.toolName === "finish",
  );
  if (
    finishRecord &&
    typeof finishRecord.result === "string" &&
    finishRecord.result.startsWith("SELF_EVALUATION_COMPLETE:")
  ) {
    console.log("✅ 全てのサブゴールの処理が完了しました。");
    const PREFIX = "SELF_EVALUATION_COMPLETE:";
    const payload = finishRecord.result.slice(PREFIX.length).trimStart();
    try {
      return JSON.parse(payload);
    } catch (e) {
      throw new Error(
        `完了結果のJSONパースに失敗しました: ${(e as Error).message}`,
      );
    }
  } else {
    throw new Error("エージェントはタスクを完了せずに終了しました。");
  }
}
