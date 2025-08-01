import { z } from "zod";

export const evaluationSchema = z.object({
  is_success: z.boolean().describe("エージェントが初期タスクを完全に達成できた場合はtrue、そうでない場合はfalse。"),
  reasoning: z.string().describe("評価の根拠を簡潔に説明してください。成功した場合はその要約を、失敗した場合は何が不足していたかを記述します。"),
});

export function getEvaluationPrompt(initialTask: string, agentFinalAnswer: string, historySummary: string): string {
  return `
# あなたの役割
あなたは、AIエージェントのタスク達成度を評価する厳格な評価者です。

# 初期タスク
${initialTask}

# エージェントの最終回答
${agentFinalAnswer}

# 実行履歴の要約
${historySummary}

# 評価基準
- エージェントの最終回答は、初期タスクで求められた全ての情報を含んでいますか？
- 回答は正確で、誤解を招くものではありませんか？
- タスクが完全に完了していますか？（途中で諦めていませんか？）

上記を基に、エージェントが初期タスクを完全に達成できたかどうかを客観的に評価してください。
`;
}
