/**
 * @file 司令塔エージェント(Chief Agent)の機能を提供します。
 * このエージェントは、ユーザーから与えられた高レベルなタスクを分析し、
 * 実行可能なサブゴールのリストに分解（計画）する役割を担します。
 */

import { LanguageModel } from "ai";
import {
  getChiefAgentPrompt,
  getChiefAgentReplanPrompt,
  chiefAgentSchema,
} from "@/src/prompts/chief";
import { getSafePath } from "@/src/utils/file";
import fs from "fs/promises";
import { AgentState } from "./agentState";
import { formatContext } from "./prompts/context";
import { generateObjectWithRetry } from "@/src/utils/llm";
import { Milestone, Subgoal, FailureContext } from "./types";

/**
 * 司令塔エージェントとして、タスクの計画または再計画を行います。
 * @param task - ユーザーから与えられた高レベルなタスク文字列。
 * @param llm - 計画生成に使用する言語モデルのインスタンス。
 * @param state - (オプション) 再計画時に現在のエージェントの状態を渡す。
 * @param failedSubgoal - (オプション) 再計画のトリガーとなった失敗したサブゴール。
 * @param errorContext - (オプション) 再計画のトリガーとなったエラー情報。
 * @param failureContext - (オプション) 失敗パターンの詳細な分析結果。
 * @returns マイルストーンの配列。
 */
export async function planMilestones(
  task: string,
  llm: LanguageModel,
  state?: AgentState,
  failedSubgoal?: Subgoal,
  errorContext?: string,
  failureContext?: FailureContext,
): Promise<Milestone[]> {
  // 再計画パラメータの整合性チェック
  const isReplanMode = state && failedSubgoal && errorContext;

  let prompt: string;
  let planFileName = "plan.json";

  if (isReplanMode) {
    // --- 再計画モード ---
    console.log("👑 司令塔エージェントがタスクを再計画...");
    const PAGE_SUMMARY_LIMIT = 1000; // 設定可能な定数として定義
    const summary = await state
      .getActivePage()
      .extract()
      .then(
        (e) =>
          e.page_text?.substring(0, PAGE_SUMMARY_LIMIT) || "ページ情報なし",
      )
      .catch(() => "ページ情報なし");
    const context = await formatContext(state, summary);
    const completedSubgoals = state.getCompletedSubgoals();

    prompt = getChiefAgentReplanPrompt({
      task,
      context,
      completedSubgoals,
      failedSubgoal: failedSubgoal.description,
      errorContext,
      failureContext,
    });
    planFileName = `replan_${Date.now()}.json`;
  } else {
    // --- 初期計画モード ---
    console.log("👑 司令塔エージェントが戦略計画を開始...");
    prompt = getChiefAgentPrompt(task);
  }

  const { object: plan } = await generateObjectWithRetry({
    model: llm,
    prompt,
    schema: chiefAgentSchema,
  });

  console.log("📝 戦略的理由:", plan.reasoning);
  console.log("📋 生成されたマイルストーンと完了条件:");
  plan.milestones.forEach((milestone: Milestone, index: number) => {
    console.log(`  ${index + 1}. [マイルストーン] ${milestone.description}`);
    console.log(`     [完了条件] ${milestone.completionCriteria}`);
  });

  try {
    const planPath = getSafePath(planFileName);
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2));
    console.log(`計画を ${planPath} に保存しました。`);
  } catch (e: any) {
    console.warn(`警告: 計画ファイルの保存に失敗しました。理由: ${e.message}`);
  }

  return plan.milestones;
}
