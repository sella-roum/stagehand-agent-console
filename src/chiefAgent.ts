/**
 * @file 司令塔エージェント(Chief Agent)の機能を提供します。
 * このエージェントは、ユーザーから与えられた高レベルなタスクを分析し、
 * 実行可能なサブゴールのリストに分解（計画）する役割を担います。
 */

import { LanguageModel, generateObject } from "ai";
import { getChiefAgentPrompt, chiefAgentSchema } from "./prompts/chief.js";
import { getSafePath } from "../utils.js";
import fs from "fs/promises";

/**
 * 司令塔エージェントとして、高レベルなタスクをサブゴールのリストに分解します。
 * 生成された計画はコンソールに表示され、`workspace/plan.json`に保存されます。
 *
 * @param task - ユーザーから与えられた高レベルなタスク文字列。
 * @param llm - 計画生成に使用する言語モデルのインスタンス。
 * @returns サブゴールの文字列を含む配列。
 * @throws {Error} LLMからの応答がスキーマに準拠していない場合にエラーが発生する可能性があります。
 */
export async function planSubgoals(task: string, llm: LanguageModel): Promise<string[]> {
  console.log("👑 司令塔エージェントがタスク計画を開始...");
  const prompt = getChiefAgentPrompt(task);

  // LLMにタスクの計画を依頼し、指定したスキーマで結果を受け取る
  const { object: plan } = await generateObject({
    model: llm,
    prompt,
    schema: chiefAgentSchema,
  });

  // 生成された計画をユーザーに提示
  console.log("📝 計画の理由:", plan.reasoning);
  console.log("📋 生成されたサブゴール:");
  plan.subgoals.forEach((goal, index) => {
    console.log(`  ${index + 1}. ${goal}`);
  });

  // 監査とデバッグのため、生成された計画をファイルに保存する
  try {
    const planPath = getSafePath("plan.json");
    await fs.writeFile(planPath, JSON.stringify(plan.subgoals, null, 2));
    console.log(`計画を ${planPath} に保存しました。`);
  } catch (e: any) {
    // ファイル保存は補助的な機能のため、失敗しても処理は続行する
    console.warn(`警告: 計画ファイルの保存に失敗しました。理由: ${e.message}`);
  }


  return plan.subgoals;
}
