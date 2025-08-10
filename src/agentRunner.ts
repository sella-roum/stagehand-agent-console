/**
 * @file 非対話モードでAIエージェントのタスク実行を担う機能を提供します。
 * Playwrightのテストケースなど、自動化された環境からエージェントを呼び出すための
 * エントリーポイントとして機能します。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "@/src/agentState";
import { getLlmInstance } from "@/src/taskAutomationAgent";
import { availableTools } from "@/src/tools";
import { AgentExecutionResult, CustomTool } from "@/src/types";
import { orchestrateAgentTask } from "./agentOrchestrator";

// テスト環境ではユーザーへの問い合わせができないため、`ask_user`ツールを無効化する
const testSafeTools: CustomTool<any>[] = availableTools.filter(
  (t) => t.name !== "ask_user",
);
const testSafeToolRegistry = new Map<string, CustomTool<any>>(
  testSafeTools.map((t) => [t.name, t]),
);

/**
 * エージェントの実行設定を定義するインターフェース。
 */
export interface AgentTaskConfig {
  /** 司令塔エージェントが生成できるサブゴールの最大数。デフォルトは10。 */
  maxSubgoals?: number;
  /** 各サブゴールで実行エージェントが試行できる最大ループ回数。デフォルトは15。 */
  maxLoopsPerSubgoal?: number;
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
  const llm = getLlmInstance();

  return await orchestrateAgentTask(task, stagehand, state, llm, {
    ...config,
    isTestEnvironment: true,
    tools: testSafeTools,
    toolRegistry: testSafeToolRegistry,
    // テスト環境では常に承認するコールバック
    approvalCallback: async (plan) => plan,
  });
}
