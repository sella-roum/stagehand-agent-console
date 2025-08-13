/**
 * @file Analyst Agentが次のアクションを計画するためのプロンプトを定義します。
 */
import { Subgoal } from "@/src/types";

/**
 * Analyst Agentに与えるプロンプトを生成します。
 * @param subgoal - 現在達成を目指しているサブゴール。
 * @param context - 現在のページ状況や履歴を含むコンテキスト情報。
 * @returns LLMに渡すためのプロンプト文字列。
 */
export function getAnalystPrompt(subgoal: Subgoal, context: string): string {
  return `
あなたは、与えられた状況と目標に基づき、次に実行すべき最適な単一のアクションを計画する分析の専門家です。

# 現在のサブゴール
${subgoal.description}

# 現在の状況
${context}

# あなたのタスク
上記の状況を分析し、サブゴールを達成するために、次に実行すべき**単一のツール呼び出し**を計画してください。
思考プロセスを簡潔に述べた上で、ツールを呼び出してください。
`;
}
