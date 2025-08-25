import { LanguageModel, ToolCall } from "ai";
import { AgentState } from "@/src/agentState";
import { BaseAnalyst, Proposal, AnalystContext } from "./baseAnalyst";
import { generateObjectWithRetry } from "@/src/utils/llm";
import { z } from "zod";

/**
 * History Analystの出力形式を定義するZodスキーマ。
 */
const historyAnalysisSchema = z.object({
  analysis: z.string().describe("エラーの原因と履歴から学んだことの分析。"),
  suggestion: z
    .string()
    .describe("失敗を回避するための具体的な次のアクションの提案。"),
  confidence: z.number().min(0).max(1).describe("提案に対する確信度。"),
});

/**
 * 実行履歴とエラー情報を分析し、失敗からの回復策を提案する専門家Analyst。
 */
export class HistoryAnalyst implements BaseAnalyst {
  private llm: LanguageModel;

  /**
   * @param llm - 思考に使用する言語モデル。
   */
  constructor(llm: LanguageModel) {
    this.llm = llm;
  }

  /**
   * 過去の失敗履歴と直近のエラーに基づき、次のアクションを提案します。
   * @param state - 現在のエージェントの状態。
   * @param context - 実行コンテキスト。
   * @returns 行動提案 (Proposal) のPromise。
   */
  async proposeAction(
    state: AgentState,
    context: AnalystContext,
  ): Promise<Proposal<any>> {
    const lastError = context.lastError;
    if (!lastError) {
      throw new Error(
        "HistoryAnalystはエラーコンテキストなしでは呼び出せません。",
      );
    }

    const history = state.getHistory();
    // 最低限の安全対策: 大きいフィールドをトリミングし、代表的な秘匿キーをマスク
    const redact = (v: any): any => {
      const SENSITIVE_KEYS = new Set([
        "password",
        "token",
        "apiKey",
        "authorization",
        "cookie",
        "cookies",
      ]);
      if (v && typeof v === "object") {
        const out: any = Array.isArray(v) ? [] : {};
        for (const k of Object.keys(v)) {
          out[k] = SENSITIVE_KEYS.has(k.toLowerCase())
            ? "[REDACTED]"
            : redact(v[k]);
        }
        return out;
      }
      if (typeof v === "string" && v.length > 800)
        return v.slice(0, 800) + "…[TRUNCATED]";
      return v;
    };
    const compactHistory = history.slice(-5).map((h) => ({
      toolCall: h.toolCall
        ? { toolName: h.toolCall.toolName, args: redact(h.toolCall.args) }
        : undefined,
      error: typeof h.error === "string" ? h.error.slice(0, 500) : h.error,
      result:
        typeof h.result === "string"
          ? h.result.slice(0, 1000) +
            (h.result.length > 1000 ? "…[TRUNCATED]" : "")
          : redact(h.result),
      subgoalDescription: h.subgoalDescription,
      successCriteria: h.successCriteria,
    }));
    const prompt = `
あなたはAIエージェントの失敗を分析する専門家です。
以下の実行履歴と発生したエラーを分析し、失敗を回避するための次のアクションを提案してください。

# 実行履歴 (直近5件)
\`\`\`json
${JSON.stringify(compactHistory, null, 2)}
\`\`\`

# 発生したエラー
\`\`\`json
${JSON.stringify(
  {
    name: lastError?.name,
    message:
      lastError?.message && lastError.message.length > 800
        ? lastError.message.slice(0, 800) + "…[TRUNCATED]"
        : lastError?.message,
  },
  null,
  2,
)}
\`\`\`

# あなたのタスク
1. なぜこのエラーが発生したのか、履歴の文脈から原因を分析してください。
2. この失敗を乗り越え、元の目標を達成するための、具体的で異なるアプローチを提案してください。
3. その提案に対する確信度を0.0から1.0の間で評価してください。
`;

    const { object: analysis } = await generateObjectWithRetry({
      model: this.llm,
      schema: historyAnalysisSchema,
      prompt,
    });

    // 分析結果をToolCallに変換する必要がある。
    // 将来的には、提案テキストからツール名と引数を抽出するより高度なロジックを実装できる。
    const toolCall: ToolCall<string, any> = {
      toolCallId: `hist-${Date.now()}`,
      toolName: "act",
      args: { instruction: analysis.suggestion },
    };

    return {
      toolCall,
      confidence: analysis.confidence,
      justification: `履歴分析に基づく提案: ${analysis.analysis}`,
    };
  }
}
