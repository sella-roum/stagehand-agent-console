/**
 * @file 非対話モードでAIエージェントのタスク実行を担う機能を提供します。
 * Playwrightのテストケースなど、自動化された環境からエージェントを呼び出すための
 * エントリーポイントとして機能します。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "@/src/agentState";
import { availableTools } from "@/src/tools";
import {
  AgentExecutionResult,
  ApprovalCallback,
  CustomTool,
} from "@/src/types";
import { orchestrateAgentTask } from "./agentOrchestrator";
import { z } from "zod";

// テスト環境ではユーザーへの問い合わせができないため、`ask_user`ツールを無効化する
const testSafeTools = availableTools.filter((t) => t.name !== "ask_user");
const testSafeToolRegistry = new Map(
  testSafeTools.map((t) => [t.name, t] as const),
);

/**
 * エージェントの実行設定を定義するインターフェース。
 */
export interface AgentTaskConfig {
  /** @deprecated マイルストーン計画に移行したため、この設定は将来的に削除されます。 */
  maxSubgoals?: number;
  /** 各サブゴールで実行エージェントが試行できる最大ループ回数。デフォルトは15。 */
  maxLoopsPerSubgoal?: number;
  /** (オプション) テストごとに使用するツールを限定する場合に指定。 */
  tools?: CustomTool<z.AnyZodObject, any>[];
  /** (オプション) テストごとに使用するツールレジストリを限定する場合に指定。 */
  toolRegistry?: Map<string, CustomTool<z.AnyZodObject, any>>;
  /** (オプション) カスタムの承認ロジックをテストする場合に指定。 */
  approvalCallback?: ApprovalCallback;
}

/**
 * 非対話モードでAIエージェントのタスクを実行します。
 * この関数は、Playwrightのテストケース内など、ユーザーの介入なしで
 * エージェントの動作を検証する目的で使用されます。
 * @param task - ユーザーが与える高レベルなタスク文字列。
 * @param stagehand - 初期化済みのStagehandインスタンス。
 * @param config - エージェントの実行に関する設定オプション。
 * @returns タスクが成功した場合は、エージェントの自己評価を含む最終結果を返します。
 * @throws {Error} タスクの計画やサブゴールの実行に失敗した場合にエラーをスローします。
 */
export async function runAgentTask(
  task: string,
  stagehand: Stagehand,
  config: AgentTaskConfig = {},
): Promise<AgentExecutionResult> {
  const state = new AgentState(stagehand);

  // テスト環境では常に承認するデフォルトのコールバック
  const defaultApprove: ApprovalCallback = async (plan) => plan;

  return await orchestrateAgentTask(task, stagehand, state, {
    ...config,
    isTestEnvironment: true,
    // 呼び出し側が与えたものを尊重し、未指定時のみテスト用のデフォルトを適用
    tools: config.tools ?? testSafeTools,
    toolRegistry: config.toolRegistry ?? testSafeToolRegistry,
    approvalCallback: config.approvalCallback ?? defaultApprove,
  });
}
