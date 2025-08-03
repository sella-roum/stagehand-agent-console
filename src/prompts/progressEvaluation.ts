/**
 * @file タスク全体の進捗を評価するためのプロンプトとスキーマを定義します。
 * この評価は、各サブゴール完了後に実行され、タスクの早期完了を判断するために使用されます。
 */

import { z } from "zod";

/**
 * 進捗評価の結果を定義するZodスキーマ。
 */
export const progressEvaluationSchema = z.object({
  isTaskCompleted: z
    .boolean()
    .describe(
      "ユーザーの初期タスクが、現在の状況と履歴を考慮して完全に達成されていると判断できる場合はtrue。",
    ),
  reasoning: z
    .string()
    .describe(
      "なぜそのように判断したかの簡潔な理由。達成されている場合は、最終的な回答となる情報を要約して含めること。",
    ),
});

/**
 * 進捗評価のためのプロンプトを生成します。
 * @param initialTask - ユーザーが最初に与えた高レベルなタスク。
 * @param historySummary - 直近の実行履歴の要約。
 * @param currentUrl - 現在のブラウザのURL。
 * @returns LLMに渡すためのプロンプト文字列。
 */
export function getProgressEvaluationPrompt(
  initialTask: string,
  historySummary: string,
  currentUrl: string,
): string {
  return `
あなたはAIエージェントの進捗を評価する厳格な監督者です。
以下の情報に基づき、エージェントがユーザーの初期タスクを既に完了したかどうかを客観的に判断してください。

# ユーザーの初期タスク
"${initialTask}"

# 直近の実行履歴の要約
\`\`\`json
${historySummary}
\`\`\`

# 現在のブラウザのURL
${currentUrl}

# あなたのタスク
上記の情報を総合的に判断し、ユーザーの初期タスクが「完全に」達成されているかを評価してください。
もし達成されているなら、'isTaskCompleted'をtrueにし、'reasoning'に最終的な回答を要約して記述してください。
まだやるべきことが残っている場合は、'isTaskCompleted'をfalseにしてください。
`;
}
