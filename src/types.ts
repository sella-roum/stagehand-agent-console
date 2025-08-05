import { z } from "zod";
import { ObserveResult } from "@browserbasehq/stagehand";
// ToolCallをインポート
import { ToolCall, LanguageModel } from "ai";
import { AgentState } from "@/src/agentState";

// エラー分析の文脈で必要となるため、簡略化したPlanStepを定義
export type PlanStep = {
  command: string;
  argument: string | null;
};

export type ExecutionRecord = {
  toolCall: ToolCall<string, any>;
  result?: any;
  error?: string;
  userFeedback?: string;
  observationResult?: ObserveResult[];
};

export type TabInfo = {
  index: number;
  title: string;
  url: string;
  isActive: boolean;
};

export const reflectionSchema = z.object({
  cause_analysis: z.string().describe("エラーの最も可能性の高い原因の分析"),
  alternative_approaches: z
    .array(z.string())
    .describe("問題を回避し、最終目標を達成するための代替アプローチのリスト"),
});

export type ReflectionResult = z.infer<typeof reflectionSchema>;

export type InterventionMode = "autonomous" | "confirm" | "edit";

// エージェントの最終実行結果の型
export type AgentExecutionResult = {
  is_success: boolean;
  reasoning: string;
};

/**
 * 事前条件チェックの結果を表す型。
 * 成功した場合は { success: true }、失敗した場合は理由を含むメッセージを返す。
 */
export type PreconditionResult =
  | { success: true }
  | { success: false; message: string };

export type CustomTool = {
  name: string;
  description: string;
  schema: z.ZodObject<any, any, any, any, any>;
  /**
   * ツール実行前に、そのツールが現在の状況で実行可能かをチェックするオプショナルな関数。
   * 失敗した場合は、その理由を含むメッセージを返す。
   */
  precondition?: (state: AgentState, args: any) => Promise<PreconditionResult>;
  execute: (
    state: AgentState,
    args: any,
    llm: LanguageModel,
    initialTask: string,
  ) => Promise<any>;
};
