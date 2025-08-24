import { z } from "zod";

/**
 * Tactical Plannerの出力形式を定義するZodスキーマ。
 */
export const tacticalPlanSchema = z.object({
  subgoals: z
    .array(
      z.object({
        description: z.string().describe("実行する具体的なサブゴール。"),
        successCriteria: z
          .string()
          .describe(
            "このサブゴールが成功したと判断するための客観的で検証可能な条件。",
          ),
      }),
    )
    .describe(
      "マイルストーンを達成するための、具体的で実行可能なサブゴールのリスト。",
    ),
});

/**
 * Tactical Plannerに与えるプロンプトを生成します。
 * @param milestoneDescription - 分解対象の高レベルなマイルストーン。
 * @param context - 現在のページ状況や履歴を含むコンテキスト情報。
 * @returns LLMに渡すためのプロンプト文字列。
 */
export function getTacticalPlannerPrompt(
  milestoneDescription: string,
  context: string,
): string {
  return `
あなたは、高レベルな目標を具体的な実行ステップに分解する、優秀な戦術プランナーです。

# 現在の状況
${context}

# 達成すべきマイルストーン
"${milestoneDescription}"

# あなたのタスク
上記の「現在の状況」を考慮し、「達成すべきマイルストーン」を完了させるために必要な、一連の具体的なサブゴールを計画してください。各サブゴールには客観的な「成功条件」を必ず定義してください。必ず指定されたJSONスキーマで出力してください。
`;
}
