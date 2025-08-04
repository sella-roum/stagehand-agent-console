/**
 * @file 司令塔エージェント(Chief Agent)の機能を提供します。
 * このエージェントは、ユーザーから与えられた高レベルなタスクを分析し、
 * 実行可能なサブゴールのリストに分解（計画）する役割を担います。
 */

import { LanguageModel, generateObject } from "ai";
import {
  getChiefAgentPrompt,
  getChiefAgentReplanPrompt,
  chiefAgentSchema,
} from "@/src/prompts/chief";
import { getSafePath } from "@/utils";
import fs from "fs/promises";
import { AgentState } from "./agentState";
import { formatContext } from "./prompts/context";

/**
 * 司令塔エージェントとして、タスクの計画または再計画を行います。
 * @param task - ユーザーから与えられた高レベルなタスク文字列。
 * @param llm - 計画生成に使用する言語モデルのインスタンス。
 * @param state - (オプション) 再計画時に現在のエージェントの状態を渡す。
 * @param failedSubgoal - (オプション) 再計画のトリガーとなった失敗したサブゴール。
 * @param errorContext - (オプション) 再計画のトリガーとなったエラー情報。
 * @returns サブゴールの文字列を含む配列。
 */
export async function planSubgoals(
  task: string,
  llm: LanguageModel,
  state?: AgentState,
  failedSubgoal?: string,
  errorContext?: string,
): Promise<string[]> {
  let prompt: string;
  let planFileName = "plan.json";

  if (state && failedSubgoal && errorContext) {
    // --- 再計画モード ---
    console.log("👑 司令塔エージェントがタスクを再計画...");
    const summary = await state
      .getActivePage()
      .extract()
      .then((e) => e.page_text?.substring(0, 1000) || "ページ情報なし")
      .catch(() => "ページ情報なし");
    const context = await formatContext(state, summary);
    const completedSubgoals = state.getCompletedSubgoals();

    prompt = getChiefAgentReplanPrompt(
      task,
      context,
      completedSubgoals,
      failedSubgoal,
      errorContext,
    );
    planFileName = `replan_${Date.now()}.json`;
  } else {
    // --- 初期計画モード ---
    console.log("👑 司令塔エージェントがタスク計画を開始...");
    prompt = getChiefAgentPrompt(task);
  }

  const { object: plan } = await generateObject({
    model: llm,
    prompt,
    schema: chiefAgentSchema,
  });

  console.log("📝 計画の理由:", plan.reasoning);
  console.log("📋 生成されたサブゴール:");
  plan.subgoals.forEach((goal, index) => {
    console.log(`  ${index + 1}. ${goal}`);
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
