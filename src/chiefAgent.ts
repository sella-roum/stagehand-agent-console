import { LanguageModel, generateObject } from "ai";
import { getChiefAgentPrompt, chiefAgentSchema } from "./prompts/chief.js";
import { getSafePath } from "../utils.js";
import fs from "fs/promises";

/**
 * 司令塔エージェントとして、高レベルなタスクをサブゴールのリストに分解します。
 * @param task - ユーザーから与えられた高レベルなタスク
 * @param llm - 使用する言語モデルのインスタンス
 * @returns サブゴールの文字列配列
 */
export async function planSubgoals(task: string, llm: LanguageModel): Promise<string[]> {
  console.log("👑 司令塔エージェントがタスク計画を開始...");
  const prompt = getChiefAgentPrompt(task);

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

  // 計画をファイルに保存
  try {
    const planPath = getSafePath("plan.json");
    await fs.writeFile(planPath, JSON.stringify(plan.subgoals, null, 2));
    console.log(`計画を ${planPath} に保存しました。`);
  } catch (e: any) {
    console.warn(`警告: 計画ファイルの保存に失敗しました。理由: ${e.message}`);
  }


  return plan.subgoals;
}
