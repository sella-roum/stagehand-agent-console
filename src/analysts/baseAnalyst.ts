import { ToolCall } from "ai";
import { AgentState } from "@/src/agentState";

/**
 * Analystが生成する単一の行動提案。
 */
export type Proposal = {
  /** 提案するツール呼び出し。 */
  toolCall: ToolCall<string, any>;
  /** 提案に対する確信度 (0.0 - 1.0)。 */
  confidence: number;
  /** なぜこの提案をしたかの簡潔な理由。 */
  justification: string;
  /** この提案の実行にVisionモデルの支援が必要か。 */
  requiresVision?: boolean;
};

/**
 * すべての専門Analystが実装すべきインターフェース。
 */
export interface BaseAnalyst {
  /**
   * 現在の状況に基づいて、次の最適なアクションを提案する。
   * @param state - 現在のエージェントの状態。
   * @param lastError - (オプション) 直前のステップで発生したエラー。
   * @returns 行動提案 (Proposal) のPromise。
   */
  proposeAction(state: AgentState, lastError?: Error): Promise<Proposal>;
}
