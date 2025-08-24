import { LanguageModel, Tool } from "ai";
import { AgentState } from "@/src/agentState";
import { BaseAnalyst, Proposal } from "./baseAnalyst";
import { getAnalystPrompt } from "@/src/prompts/analyst";
import { formatContext } from "@/src/prompts/context";
import { generateTextWithRetry } from "@/src/utils/llm";
import { availableTools } from "@/src/tools";
import { z } from "zod";
import { CustomTool } from "@/src/types";

/**
 * カスタムツールをVercel AI SDKが要求する形式に変換します。
 * @param tools - カスタムツールの配列。
 * @returns Vercel AI SDK形式のツールオブジェクト。
 */
function mapCustomToolsToAITools(
  tools: ReadonlyArray<CustomTool<z.AnyZodObject, unknown>>,
): Record<string, Tool> {
  return tools.reduce(
    (acc, tool) => {
      acc[tool.name] = {
        description: tool.description,
        parameters: tool.schema,
      };
      return acc;
    },
    {} as Record<string, Tool>,
  );
}

/**
 * DOMツリーの分析に特化した専門家Analyst。
 * エージェントの基本的な行動計画を担当する。
 */
export class DomAnalyst implements BaseAnalyst {
  private llm: LanguageModel;

  /**
   * @param llm - 思考に使用する言語モデル。
   */
  constructor(llm: LanguageModel) {
    this.llm = llm;
  }

  /**
   * 現在のDOM状態とタスクに基づき、次のアクションを提案します。
   * @param state - 現在のエージェントの状態。
   * @returns 行動提案 (Proposal) のPromise。
   */
  async proposeAction(state: AgentState): Promise<Proposal<any>> {
    const summary = await state
      .getActivePage()
      .extract()
      .then((e) => e?.page_text?.substring(0, 2000) || "ページ情報なし")
      .catch((error) => {
        console.warn(`ページ情報の抽出に失敗: ${error.message}`);
        return "ページ情報なし";
      });
    const context = await formatContext(state, summary);
    const currentSubgoal = state.getHistory().slice(-1)[0]?.subgoalDescription;

    if (!currentSubgoal) {
      throw new Error("現在のサブゴールが不明です。");
    }

    const prompt = getAnalystPrompt(
      { description: currentSubgoal, successCriteria: "" },
      context,
    );

    const { toolCalls, text } = await generateTextWithRetry({
      model: this.llm,
      messages: [{ role: "user", content: prompt }],
      tools: mapCustomToolsToAITools(availableTools),
    });

    if (!toolCalls || toolCalls.length === 0) {
      throw new Error("DOM Analystがアクションを提案できませんでした。");
    }

    const toolCall = toolCalls[0];

    const requiresVision = !!(
      toolCall.toolName === "vision_analyze" ||
      toolCall.toolName === "click_at_coordinates" ||
      (text && /(?:vision|screenshot|画像|スクリーンショット)/i.test(text))
    );

    return {
      toolCall,
      confidence: 0.9, // 仮の確信度
      justification: text || "DOM分析に基づき、最も合理的と判断しました。",
      requiresVision,
    };
  }
}
