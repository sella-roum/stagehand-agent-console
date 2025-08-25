import { ToolCall } from "ai";
import { AgentState } from "@/src/agentState";
import { Subgoal } from "@/src/types";

/**
 * Analystが必要とする可能性のあるすべてのコンテキスト情報をまとめた型。
 */
export type AnalystContext = {
  subgoal: Subgoal;
  lastError?: Error;
};

/**
 * Analystが生成する単一の行動提案。
 * @template TArgs - ツール呼び出しの引数の型。
 */
export type Proposal<TArgs = unknown> = {
  /** 提案するツール呼び出し。 */
  toolCall: ToolCall<string, TArgs>;
  /** 提案に対する確信度 (0.0 - 1.0)。 */
  confidence: number;
  /** なぜこの提案をしたかの簡潔な理由。 */
  justification: string;
  /** この提案の実行にVisionモデルの支援が必要か。 */
  requiresVision?: boolean;
};

/**
 * すべての専門Analystが実装すべきインターフェース。
 * @template TArgs - 提案するツール呼び出しの引数の型。
 */
export interface BaseAnalyst<TArgs = unknown> {
  /**
   * 現在の状況に基づいて、次の最適なアクションを提案する。
   * @param state - 現在のエージェントの状態。
   * @param context - サブゴールや直前のエラーを含む実行コンテキスト。
   * @returns 行動提案 (Proposal) のPromise。
   */
  proposeAction(
    state: AgentState,
    context: AnalystContext,
  ): Promise<Proposal<TArgs>>;
}
