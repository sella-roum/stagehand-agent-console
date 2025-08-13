/**
 * @file QA Agentがサブゴールの成功を検証するためのプロンプトとスキーマを定義します。
 */
import { z } from "zod";
import { Subgoal } from "@/src/types";

/**
 * QA Agentの出力形式を定義するZodスキーマ。
 */
export const qaSchema = z.object({
  isSuccess: z
    .boolean()
    .describe("成功条件が満たされていればtrue、そうでなければfalse。"),
  reasoning: z.string().describe("なぜそのように判断したかの簡潔な理由。"),
});

/**
 * QA Agentに与えるプロンプトを生成します。
 * @param subgoal - 検証対象のサブゴール。
 * @param context - 現在のページ状況や履歴を含むコンテキスト情報。
 * @returns LLMに渡すためのプロンプト文字列。
 */
export function getQAPrompt(subgoal: Subgoal, context: string): string {
  return `
あなたは、AIエージェントの行動結果を客観的に検証する品質保証(QA)の専門家です。

# 検証対象のサブゴール
${subgoal.description}

# 成功条件
「${subgoal.successCriteria}」

# 現在の状況
${context}

# あなたのタスク
上記の「現在の状況」が、定義された「成功条件」を満たしているかどうかを厳密に判断してください。
`;
}
