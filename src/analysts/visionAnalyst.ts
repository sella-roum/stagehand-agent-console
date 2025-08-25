import { LanguageModel, ToolCall } from "ai";
import { AgentState } from "@/src/agentState";
import { BaseAnalyst, Proposal, AnalystContext } from "./baseAnalyst";
import { generateObjectWithRetry } from "@/src/utils/llm";
import { z } from "zod";
import { randomUUID } from "crypto";

/**
 * Vision Analystの出力形式を定義するZodスキーマ。
 */
const visionAnalysisSchema = z.object({
  analysis: z.string().describe("スクリーンショットの視覚的分析結果。"),
  suggestion: z
    .object({
      toolName: z
        .string()
        .describe("提案するツール名 (例: 'click_at_coordinates')"),
      args: z.any().describe("提案するツールの引数 (JSONオブジェクト)"),
    })
    .describe("分析に基づいた具体的な次のアクションの提案。"),
  confidence: z.number().min(0).max(1).describe("提案に対する確信度。"),
});

/**
 * スクリーンショットを視覚的に分析し、行動を提案する専門家Analyst。
 * AGENT_MODE='vision'の場合にのみ起動される。
 */
export class VisionAnalyst implements BaseAnalyst {
  private llm: LanguageModel;

  /**
   * @param llm - 思考に使用するVision対応の言語モデル。
   */
  constructor(llm: LanguageModel) {
    this.llm = llm;
  }

  /**
   * 現在のスクリーンショットを分析し、次のアクションを提案します。
   * @param state - 現在のエージェントの状態。
   * @param context - 実行コンテキスト。
   * @returns 行動提案 (Proposal) のPromise。
   */
  async proposeAction(
    state: AgentState,
    context: AnalystContext,
  ): Promise<Proposal<any>> {
    const page = state.getActivePage();
    const screenshotBuffer = await page.screenshot();
    const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;

    const currentSubgoal =
      context.subgoal.description || "現在のタスクを達成する";

    const prompt = `
あなたはスクリーンショットを分析して次の行動を決定する視覚AIエキスパートです。
以下のスクリーンショットを見て、現在の目標を達成するために最適なアクションを提案してください。

# 現在の目標
${currentSubgoal}

# あなたのタスク
1. スクリーンショットを注意深く分析してください。
2. 目標達成のために最も効果的だと思われるアクションを一つ提案してください。DOMでは見つけにくい要素（例：アイコンのみのボタン、地図上のピン）の操作に特に注意してください。
3. 提案するアクションは、利用可能なツール（例: 'click_at_coordinates'）の呼び出し形式で具体的に記述してください。
4. その提案に対する確信度を0.0から1.0の間で評価してください。
`;

    const { object: analysis } = await generateObjectWithRetry({
      model: this.llm,
      schema: visionAnalysisSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image", image: new URL(screenshotDataUrl) },
          ],
        },
      ],
    });

    const toolCall: ToolCall<string, any> = {
      toolCallId: `vis-${randomUUID()}`,
      toolName: analysis.suggestion.toolName,
      args: analysis.suggestion.args,
    };

    return {
      toolCall,
      confidence: analysis.confidence,
      justification: `視覚分析に基づく提案: ${analysis.analysis}`,
    };
  }
}
