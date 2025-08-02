import { Stagehand } from "@browserbasehq/stagehand";
import { AgentState } from "./agentState.js";
import { planSubgoals } from "./chiefAgent.js";
import { taskAutomationAgent, getLlmInstance } from "./taskAutomationAgent.js";
import { availableTools } from "./tools/index.js";
import { AgentExecutionResult, CustomTool } from "./types.js";

// askUserツールを無効化したテスト用のツールセットを作成
const testSafeTools: CustomTool[] = availableTools.filter(t => t.name !== 'ask_user');
const testSafeToolRegistry = new Map<string, CustomTool>(testSafeTools.map(t => [t.name, t]));

export interface AgentTaskConfig {
  maxSubgoals?: number;
  maxLoopsPerSubgoal?: number;
}

/**
 * 非対話モードでAIエージェントのタスクを実行する
 * @param task - ユーザーが与える高レベルなタスク
 * @param stagehand - Stagehandのインスタンス
 * @param config - エージェントの実行設定
 * @returns タスクが成功した場合は最終結果、失敗した場合はエラーをスロー
 */
export async function runAgentTask(
  task: string,
  stagehand: Stagehand,
  config: AgentTaskConfig = {}
): Promise<AgentExecutionResult> {
  const { maxSubgoals = 10, maxLoopsPerSubgoal = 15 } = config;
  const state = new AgentState(stagehand);
  const llm = getLlmInstance();

  // 1. 司令塔エージェントによる計画立案
  console.log(`👑 司令塔エージェントがタスク計画を開始: "${task}"`);
  const subgoals = await planSubgoals(task, llm);
  if (subgoals.length > maxSubgoals) {
    throw new Error(`計画されたサブゴールが多すぎます: ${subgoals.length} > ${maxSubgoals}`);
  }

  // 2. 各サブゴールの実行
  for (const [index, subgoal] of subgoals.entries()) {
    console.log(`\n▶️ サブゴール ${index + 1}/${subgoals.length} 実行中: "${subgoal}"`);
    
    const success = await taskAutomationAgent(
      subgoal,
      stagehand,
      state,
      task,
      { 
        isTestEnvironment: true, // 非対話モードであることを示すフラグ
        maxLoops: maxLoopsPerSubgoal,
        tools: testSafeTools, // askUserを除外したツールセット
        toolRegistry: testSafeToolRegistry,
      }
    );

    if (!success) {
      throw new Error(`サブゴール "${subgoal}" の実行に失敗しました。`);
    }
  }

  // 3. 最終結果の確認
  const finalHistory = state.getHistory();
  const finishRecord = finalHistory.find(h => h.toolCall.toolName === 'finish');
  if (finishRecord && typeof finishRecord.result === 'string' && finishRecord.result.startsWith('SELF_EVALUATION_COMPLETE:')) {
    console.log("✅ 全てのサブゴールの処理が完了しました。");
    // SELF_EVALUATION_COMPLETE: { ... } のような文字列からJSON部分を抽出
    const resultJson = finishRecord.result.replace('SELF_EVALUATION_COMPLETE: ', '');
    return JSON.parse(resultJson);
  } else {
    throw new Error("エージェントはタスクを完了せずに終了しました。");
  }
}
