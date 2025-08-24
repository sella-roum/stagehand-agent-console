import { z } from "zod";

/**
 * Tactical Plannerの出力形式を定義するZodスキーマ。
 */
export const tacticalPlanSchema = z
  .object({
    subgoals: z
      .array(
        z
          .object({
            description: z
              .string()
              .trim()
              .min(1, "descriptionは空にできません。")
              .max(500, "descriptionは500文字以内でなければなりません。")
              .describe("実行する具体的なサブゴール。"),
            successCriteria: z
              .string()
              .trim()
              .min(1, "successCriteriaは空にできません。")
              .max(500, "successCriteriaは500文字以内でなければなりません。")
              .describe(
                "このサブゴールが成功したと判断するための客観的で検証可能な条件。",
              ),
          })
          .strict(),
      )
      .min(1, "少なくとも1つのサブゴールが必要です。")
      .max(10, "サブゴールの数は10個以内でなければなりません。")
      .describe(
        "マイルストーンを達成するための、具体的で実行可能なサブゴールのリスト。",
      ),
  })
  .strict();

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
  const safeContext = context.replace(/`/g, "\\`");
  const safeMilestone = milestoneDescription.replace(/`/g, "\\`");
  return `
あなたは、高レベルな目標を具体的な実行ステップに分解する、優秀な戦術プランナーです。

# 現在の状況
\`\`\`text
${safeContext}
\`\`\`

# 達成すべきマイルストーン
"${safeMilestone}"

# あなたのタスク
上記の「現在の状況」を考慮し、「達成すべきマイルストーン」を完了させるために必要な、一連の具体的なサブゴールを計画してください。各サブゴールには客観的な「成功条件」を必ず定義してください。必ず指定されたJSONスキーマで出力してください。
`;
}
