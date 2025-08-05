/**
 * @file エージェントの記憶管理（要約と重要事実の抽出）のためのプロンプトとスキーマを定義します。
 */

import { z } from "zod";

/**
 * 記憶更新のためのLLMの出力形式を定義するZodスキーマ。
 */
export const memoryUpdateSchema = z.object({
  subgoal_summary: z
    .string()
    .describe(
      "完了したサブゴールの実行内容と結果の簡潔な要約。次のステップのコンテキストとして利用される。",
    ),
  long_term_memory_facts: z
    .array(z.string())
    .describe(
      "このサブゴールから得られた、タスク全体の目標達成に不可欠な、永続化すべき事実のリスト。例: 'ユーザーのメールアドレスは test@example.com である'、'最終的に目指すべきページのURLは https://example.com/dashboard である'。何もなければ空配列。",
    ),
});

/**
 * 記憶更新のためのプロンプトを生成します。
 * @param initialTask - ユーザーが最初に与えた高レベルなタスク。
 * @param subgoal - 完了したサブゴール。
 * @param subgoalHistoryJson - 完了したサブゴールの実行履歴（JSON文字列）。
 * @returns LLMに渡すためのプロンプト文字列。
 */
export function getMemoryUpdatePrompt(
  initialTask: string,
  subgoal: string,
  subgoalHistoryJson: string,
): string {
  // JSONの妥当性を念のためチェック
  try {
    JSON.parse(subgoalHistoryJson);
  } catch (e: any) {
    // ログに出力するが、処理は続行させる
    console.warn(
      `Invalid JSON provided for subgoal history: ${e.message}`,
    );
  }

  return `
あなたはAIエージェントの行動を分析し、記憶を整理する役割を担っています。
以下の情報を基に、完了したサブゴールの要約と、長期記憶に追加すべき重要な事実を抽出してください。

# ユーザーの最終目標
${initialTask}

# 完了したサブゴール
${subgoal}

# このサブゴールの実行履歴
\`\`\`json
${subgoalHistoryJson.replace(/`/g, "\\`")}
\`\`\`

# あなたのタスク
1.  **要約の生成:** 上記の実行履歴を分析し、何が行われ、どのような結果になったのかを簡潔に要約してください。これは次のサブゴールを実行する際の短期的なコンテキストになります。
2.  **重要事実の抽出:** 実行履歴の中から、ユーザーの最終目標を達成するために、今後も覚えておくべき**不変の事実**を抽出してください。
    -   **良い例:** ログインID、抽出した特定のデータ（価格、住所など）、重要なURL。
    -   **悪い例:** 一時的なページのレイアウト、クリックしたボタンのテキスト（変更される可能性があるため）。
    -   もし、長期的に記憶すべき重要な事実がなければ、\`long_term_memory_facts\`は空の配列 \`[]\` にしてください。

# 出力形式
必ず指定されたJSONスキーマに従って出力してください。
`;
}
