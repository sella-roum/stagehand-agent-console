import { z } from "zod";
import { ObserveResult } from "@browserbasehq/stagehand";
// ToolCallをインポート
import { ToolCall, LanguageModel } from "ai";
import { AgentState } from "@/src/agentState";

/**
 * エラー分析の文脈で必要となるため、簡略化したPlanStepを定義
 * @deprecated より構造化された型に置き換えられています。
 */
export type PlanStep = {
  command: string;
  argument: string | null;
};

/**
 * 司令塔エージェントによって生成される単一のサブゴールを表す型。
 * 戦術計画の最小単位。
 */
export type Subgoal = {
  /** 実行する具体的なサブゴール。 */
  description: string;
  /** このサブゴールが成功したと判断するための客観的で検証可能な条件。 */
  successCriteria: string;
};

/**
 * Chief Agentによって生成される高レベルな計画単位。
 * これがさらに具体的なサブゴールに分解される。
 */
export type Milestone = {
  /** 達成すべき高レベルなマイルストーン。 */
  description: string;
  /** このマイルストーンが完了したと判断するための客観的で検証可能な条件。 */
  completionCriteria: string;
};

/**
 * 単一のマイルストーンを達成するための具体的なサブゴールのリスト。
 * Tactical Plannerによって生成される。
 */
export type TacticalPlan = Subgoal[];

/**
 * タスク全体の計画を表す型。Subgoalの配列。
 * @deprecated Milestone[]に置き換えられました。
 */
export type Plan = Subgoal[];

/**
 * エージェントの一回の行動（ツール呼び出し）とその結果を記録する型。
 */
export type ExecutionRecord = {
  /** 実行されたツール呼び出し。 */
  toolCall: ToolCall<string, any>;
  /** この行動が属していたサブゴールの説明。 */
  subgoalDescription?: string;
  /** この行動が属していたサブゴールの成功条件。 */
  successCriteria?: string;
  /** ツールの実行結果。 */
  result?: any;
  /** 発生したエラーメッセージ（あれば）。 */
  error?: string;
  /** ユーザーからのフィードバック（あれば）。 */
  userFeedback?: string;
  /** `observe`ツールの実行結果（あれば）。 */
  observationResult?: ObserveResult[];
};

/**
 * 単一のブラウザタブに関する情報を表す型。
 */
export type TabInfo = {
  /** タブのインデックス番号。 */
  index: number;
  /** タブのタイトル。 */
  title: string;
  /** タブのURL。 */
  url: string;
  /** このタブが現在アクティブかどうか。 */
  isActive: boolean;
};

/**
 * 自己修復（Reflection）プロセスのためのLLMの出力スキーマ。
 */
export const reflectionSchema = z.object({
  cause_analysis: z.string().describe("エラーの最も可能性の高い原因の分析"),
  alternative_approaches: z
    .array(z.string())
    .describe("問題を回避し、最終目標を達成するための代替アプローチのリスト"),
});

/**
 * 自己修復（Reflection）プロセスの結果を表す型。
 */
export type ReflectionResult = z.infer<typeof reflectionSchema>;

/**
 * ユーザーの介入モードを表す型。
 * - `autonomous`: 完全自律モード。AIは確認なしに行動する。
 * - `confirm`: 確認モード。AIは行動前にユーザーの承認を求める。
 * - `edit`: 編集モード。ユーザーはAIの計画を編集できる。
 */
export type InterventionMode = "autonomous" | "confirm" | "edit";

/**
 * エージェントのタスク全体の最終実行結果を表す型。
 */
export type AgentExecutionResult = {
  /** タスクが成功したかどうか。 */
  is_success: boolean;
  /** 成功の要約、または失敗の理由。 */
  reasoning: string;
};

/**
 * ユーザー承認コールバックの型定義。
 * @param plan - AIが生成した実行計画
 * @returns 承認された場合は計画を、拒否された場合はnullを返すPromise
 */
export type ApprovalCallback<TArgs = unknown> = (
  plan: ToolCall<string, TArgs>[],
) => Promise<ToolCall<string, TArgs>[] | null>;

/**
 * 事前条件チェックの結果を表す型。
 * 成功した場合は { success: true }、失敗した場合は理由を含むメッセージを返す。
 */
export type PreconditionResult =
  | { success: true }
  | { success: false; message: string };

/**
 * エージェントが利用可能なカスタムツールのインターフェース定義。
 * @template T - ツールの引数を検証するためのZodスキーマ。
 * @template R - ツールの`execute`メソッドが返す値の型。
 */
export type CustomTool<
  T extends z.ZodObject<any, any, any, any, any>,
  R = any,
> = {
  /** ツールのユニークな名前。 */
  name: string;
  /** LLMがツールの機能を理解するための説明。 */
  description: string;
  /** ツールの引数を定義し、検証するためのZodスキーマ。 */
  schema: T;
  /**
   * ツール実行前に、そのツールが現在の状況で実行可能かをチェックするオプショナルな関数。
   * 失敗した場合は、その理由を含むメッセージを返す。
   */
  precondition?: (
    state: AgentState,
    args: z.infer<T>,
  ) => Promise<PreconditionResult> | PreconditionResult;
  /**
   * ツールの本体ロジック。
   * @param state - 現在のエージェントの状態。
   * @param args - スキーマで検証済みの引数。
   * @param llm - ツール内でLLMの思考が必要な場合に使用する言語モデル。
   * @param initialTask - ユーザーが最初に与えたタスク全体。
   * @returns ツールの実行結果。
   */
  execute: (
    state: AgentState,
    args: z.infer<T>,
    llm: LanguageModel,
    initialTask: string,
  ) => Promise<R>;
};

/**
 * FailureTrackerによって生成される、失敗パターンの分析結果。
 * Chief Agentの再計画プロンプトに渡される。
 */
export type FailureContext = {
  /** 連続失敗回数。 */
  consecutiveFailures: number;
  /** 同じツールが同じ引数で繰り返し失敗した場合の情報。 */
  repeatedFailure?: {
    toolName: string;
    args: any;
    count: number;
  };
  /** ブラウザの状態（URL）が変化しないまま失敗が続いた回数。 */
  stagnationCount: number;
  /** LLM向けの失敗状況の自然言語による要約。 */
  summary: string;
};

/**
 * 再計画が必要であることを示すためのカスタムエラー。
 * 失敗のコンテキスト情報を保持し、Orchestratorに伝える。
 */
export class ReplanNeededError extends Error {
  /** 元となったエラーオブジェクト。 */
  public originalError: Error;
  /** 失敗したツール呼び出しの情報。 */
  public failedToolCall: ToolCall<string, unknown>;
  /** FailureTrackerによって分析された失敗コンテキスト。 */
  public failureContext?: FailureContext;

  /**
   * @param message - エラーメッセージ。
   * @param originalError - 元となったエラーオブジェクト。
   * @param failedToolCall - 失敗したツール呼び出し。
   * @param failureContext - (オプション) 失敗パターンの分析結果。
   */
  constructor(
    message: string,
    originalError: Error,
    failedToolCall: ToolCall<string, unknown>,
    failureContext?: FailureContext,
  ) {
    super(message);
    this.name = "ReplanNeededError";
    this.originalError = originalError;
    this.failedToolCall = failedToolCall;
    this.failureContext = failureContext;
  }
}
