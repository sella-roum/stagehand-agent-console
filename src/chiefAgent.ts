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
import { Plan, Subgoal } from "./types";

/**
 * 司令塔エージェントとして、タスクの計画または再計画を行います。
 * @param task - ユーザーから与えられた高レベルなタスク文字列。
 * @param llm - 計画生成に使用する言語モデルのインスタンス。
 * @param state - (オプション) 再計画時に現在のエージェントの状態を渡す。
 * @param failedSubgoal - (オプション) 再計画のトリガーとなった失敗したサブゴール。
 * @param errorContext - (オプション) 再計画のトリガーとなったエラー情報。
 * @returns サブゴールの配列。
 */
export async function planSubgoals(
  task: string,
  llm: LanguageModel,
  state?: AgentState,
  failedSubgoal?: Subgoal,
  errorContext?: string,
): Promise<Plan> {
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
    });
    planFileName = `replan_${Date.now()}.json`;
  } else {
    // --- 初期計画モード ---
    console.log("👑 司令塔エージェントがタスク計画を開始...");
    prompt = getChiefAgentPrompt(task);
  }

  const { object: plan } = await generateObjectWithRetry({
    model: llm,
    prompt,
    schema: chiefAgentSchema,
  });

  console.log("📝 計画の理由:", plan.reasoning);
  console.log("📋 生成されたサブゴールと成功条件:");
  plan.subgoals.forEach((goal: Subgoal, index: number) => {
    console.log(`  ${index + 1}. [サブゴール] ${goal.description}`);
    console.log(`     [成功条件] ${goal.successCriteria}`);
  });

  try {
    const planPath = getSafePath(planFileName);
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2));
    console.log(`計画を ${planPath} に保存しました。`);
  } catch (e: any) {
    console.warn(`警告: 計画ファイルの保存に失敗しました。理由: ${e.message}`);
  }

  return plan.subgoals;
}
