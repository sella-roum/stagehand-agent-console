/**
 * @file 司令塔エージェント(Chief Agent)がタスク計画を立てるためのプロンプトとスキーマを定義します。
 */

import { z } from "zod";
import { FailureContext } from "@/src/types";

/**
 * 司令塔エージェントの出力形式を定義するZodスキーマ。
 * `subgoals`と`reasoning`の2つのフィールドを持つJSONオブジェクトを期待します。
 */
export const chiefAgentSchema = z.object({
  milestones: z
    .array(
      z.object({
        description: z
          .string()
          .describe("達成すべき高レベルなマイルストーン。"),
        completionCriteria: z
          .string()
          .describe(
            "このマイルストーンが完了したと判断するための客観的で検証可能な条件。",
          ),
      }),
    )
    .describe(
      "タスクを達成するための2〜5個の高レベルなマイルストーンのリスト。",
    ),
  reasoning: z
    .string()
    .describe("なぜこれらのマイルストーンに分解したかの簡潔な戦略的理由。"),
});

/**
 * 司令塔エージェントに与える初期計画用のプロンプトを生成します。
 * @param task - ユーザーから与えられた高レベルなタスク文字列。
 * @returns LLMに渡すためのプロンプト文字列。
 */
export function getChiefAgentPrompt(task: string): string {
  return `
あなたは、複雑なタスクを達成可能な大きなステップに分解する、卓越した戦略プランナーです。あなたの役割は、ユーザーの最終目標を分析し、それを達成するための主要な「マイルストーン」からなる戦略計画を立案することです。

# あなたの思考プロセス
1.  **最終目標の把握:** ユーザーが何を達成したいのか、その核心を理解します。
2.  **戦略的分解:** タスクを2〜5個の論理的なマイルストーンに分解します。各マイルストーンは、タスク全体の大きな進捗を示すものであるべきです。詳細なクリックや入力の指示は不要です。
    - 良いマイルストーンの例: 「ウェブサイトにログインする」「製品情報を検索し、リストアップする」「最も安い製品を選択し、カートに追加する」
    - 悪いマイルストーンの例: 「'ユーザー名'の入力欄をクリックする」「'次へ'ボタンを探す」
3.  **完了条件の定義:** 各マイルストーンに対して、それが完了したと客観的に判断できる「完了条件」を必ず定義してください。
    - 良い完了条件の例: 「ページのタイトルが'ダッシュボード'になっている」「製品リストが画面に表示されている」
4.  **出力の厳守:** 必ず指定されたJSONスキーマで出力してください。

# ユーザーからのタスク
"${task}"

上記のタスクを達成するためのマイルストーン計画を生成してください。
`;
}

/**
 * getChiefAgentReplanPrompt関数のパラメータ型定義
 */
interface ReplanPromptParams {
  task: string;
  context: string;
  completedSubgoals: string[];
  failedSubgoal: string;
  errorContext: string;
  failureContext?: FailureContext;
}

/**
 * 司令塔エージェントに再計画を促すプロンプトを生成します。
 * @param params - 再計画に必要なパラメータを含むオブジェクト。
 * @returns LLMに渡すための再計画用プロンプト文字列。
 */
export function getChiefAgentReplanPrompt(params: ReplanPromptParams): string {
  const {
    task,
    context,
    completedSubgoals,
    failedSubgoal,
    errorContext,
    failureContext,
  } = params;

  const failureAnalysisSection = failureContext
    ? `
# 失敗パターンの分析
${failureContext.summary}
`
    : `
# 失敗の原因となったエラーの要約
${errorContext}
`;

  return `
あなたは、予期せぬ事態に対応する能力に長けた、経験豊富なAIプロジェクトマネージャーです。
実行中のタスクがエラーにより停滞しています。現在の状況を分析し、最終目標を達成するための新しい計画を立て直すか、タスクの達成が不可能であると判断してください。

# ユーザーの最終目標
"${task}"

# 現在の状況
${context}

# これまでに完了したサブゴール
${
  completedSubgoals.length > 0
    ? completedSubgoals.map((g, i) => `${i + 1}. ${g}`).join("\n")
    : "なし"
}

# 失敗したサブゴール
"${failedSubgoal}"

${failureAnalysisSection}

# あなたのタスク
1.  **状況分析:** 上記の情報を総合的に分析し、タスクの続行が現実的か判断してください。
2.  **再計画または中止:**
    -   **続行可能と判断した場合:** 失敗パターンを回避し、最終目標を達成するための**新しいマイルストーン計画**を生成してください。
    -   **続行不可能と判断した場合:** 計画の代わりに、**単一の\`finish\`ツール呼び出しを含む計画**を生成してください。その際の\`answer\`には、なぜタスクが達成不可能であるかの理由を明確に記述してください。
3.  **出力の厳守:** 必ず指定されたJSON形式で出力してください。
`;
}
