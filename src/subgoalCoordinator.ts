/**
 * @file 実行エージェントチームを統括するSubgoal Coordinatorの機能を提供します。
 * このコーディネーターは、司令塔から与えられたマイルストーンを達成するために、
 * 戦術計画の立案、分析、実行、検証、自己修復のループを専門エージェントチームを率いて実行します。
 */

import { Stagehand, Page } from "@browserbasehq/stagehand";
import { LanguageModel, ToolCall } from "ai";
import { z } from "zod";

import { AgentState } from "@/src/agentState";
import { formatContext } from "@/src/prompts/context";
import { toolRegistry } from "@/src/tools/index";
import {
  CustomTool,
  ApprovalCallback,
  Subgoal,
  reflectionSchema,
  Milestone,
  TacticalPlan,
  ReplanNeededError,
  AgentExecutionResult,
} from "@/src/types";
import {
  generateObjectWithRetry,
} from "@/src/utils/llm";
import { getQAPrompt, qaSchema } from "@/src/prompts/qa";
import { logAgentMessage } from "@/src/utils/ui";
import { getReflectionPrompt, formatReflection } from "./prompts/reflection";
import { getTacticalPlannerPrompt, tacticalPlanSchema } from "./prompts/tacticalPlanner";
import { FailureTracker } from "./failureTracker";
import { DomAnalyst } from "./analysts/domAnalyst";
import { HistoryAnalyst } from "./analysts/historyAnalyst";
import { VisionAnalyst } from "./analysts/visionAnalyst";
import { Proposal } from "./analysts/baseAnalyst";
import { updateMemoryAfterSubgoal } from "./utils/memory";
import { getProgressEvaluationPrompt, progressEvaluationSchema } from "./prompts/progressEvaluation";

/**
 * ログ出力用に機密情報をマスキングするヘルパー関数
 * @param obj - マスキング対象のオブジェクト
 * @returns 機密情報がマスクされたオブジェクトのクローン
 */
function maskSensitive<T extends Record<string, unknown>>(obj: T): T {
  const SENSITIVE_KEYS = [
    "password",
    "pass",
    "token",
    "apiKey",
    "secret",
    "authorization",
  ];
  const clone: any = Array.isArray(obj)
    ? [...(obj as any)]
    : { ...(obj as any) };
  for (const k of Object.keys(clone)) {
    if (clone[k] && typeof clone[k] === "object") {
      clone[k] = maskSensitive(clone[k]);
    } else if (
      SENSITIVE_KEYS.some((sk) => k.toLowerCase().includes(sk.toLowerCase()))
    ) {
      clone[k] = "***redacted***";
    }
  }
  return clone;
}

/**
 * 新しいページ（ポップアップなど）が開かれた際のグローバルイベントハンドラを設定します。
 * Visionモデルを使用し、不要なポップアップ（広告、クッキー同意など）を自動で閉じます。
 * @param stagehand - Stagehandのインスタンス。
 * @param llm - Vision分析に使用する言語モデルのインスタンス。
 */
const POPUP_HANDLER_KEY = Symbol.for("stagehand:popup-handler-installed");

async function setupGlobalEventHandlers(
  stagehand: Stagehand,
  llm: LanguageModel,
) {
  const context = stagehand.page.context() as any;
  if (context[POPUP_HANDLER_KEY]) {
    return; // 既にインストール済み
  }
  context[POPUP_HANDLER_KEY] = true;

  context.on("page", async (newPage: Page) => {
    try {
      console.log(
        `\n🚨 新しいページ/ポップアップが検出されました: ${await newPage.title()}`,
      );
      await newPage
        .waitForLoadState("domcontentloaded", { timeout: 5000 })
        .catch(() => {});

      const screenshotBuffer = await newPage.screenshot();
      const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;

      const popupAnalysisSchema = z.object({
        isUnwantedPopup: z
          .boolean()
          .describe(
            "これが広告、クッキー同意、またはメインタスクを妨げる不要なポップアップであればtrue",
          ),
        reasoning: z.string(),
      });

      const { object: analysis } = await generateObjectWithRetry({
        model: llm,
        schema: popupAnalysisSchema,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "この新しいページは、メインのタスクを妨げる不要なポップアップ（広告、クッキー同意など）ですか？",
              },
              { type: "image", image: new URL(screenshotDataUrl) },
            ],
          },
        ],
      });

      if (analysis.isUnwantedPopup) {
        console.log(
          `  ...不要なポップアップと判断しました。理由: ${analysis.reasoning}。自動的に閉じます。`,
        );
        await newPage.close();
      } else {
        console.log(
          `  ...メインタスクに関連するページと判断しました。理由: ${analysis.reasoning}`,
        );
      }
    } catch (e: any) {
      console.warn(`ポップアップハンドラでエラーが発生しました: ${e.message}`);
    }
  });
}

/**
 * LLMインスタンスをまとめた型定義。
 */
type LlmInstances = {
  highPerformance: LanguageModel;
  fast: LanguageModel;
  medium?: LanguageModel;
};

/**
 * 高レベルなマイルストーンを、実行可能なサブゴールのリストに詳細化します。
 * @param milestone - 詳細化するマイルストーン。
 * @param state - 現在のエージェントの状態。
 * @param llm - 計画に使用する言語モデル。
 * @returns サブゴールの配列（戦術計画）。
 */
async function elaborateMilestone(
  milestone: Milestone,
  state: AgentState,
  llm: LanguageModel,
): Promise<TacticalPlan> {
  console.log(
    `  ...♟️ 戦術プランナーがマイルストーンを詳細化中: "${milestone.description}"`,
  );
  const summary = await state
    .getActivePage()
    .extract()
    .then((e) => e?.page_text?.substring(0, 2000) || "ページ情報なし")
    .catch(() => "ページ情報なし");
  const context = await formatContext(state, summary);
  const prompt = getTacticalPlannerPrompt(milestone.description, context);

  const { object: plan } = await generateObjectWithRetry({
    model: llm,
    schema: tacticalPlanSchema,
    prompt,
  });

  return plan.subgoals;
}

/**
 * Analyst Swarmを実行し、次の最適なアクションを決定します。
 * @param subgoal - 現在のサブゴール。
 * @param state - 現在のエージェントの状態。
 * @param llms - 使用するLLMインスタンス群。
 * @param lastError - (オプション) 直前のステップで発生したエラー。
 * @returns 最適と判断された単一のツール呼び出し。
 */
async function runAnalystSwarm(
  subgoal: Subgoal,
  state: AgentState,
  llms: LlmInstances,
  lastError?: Error,
): Promise<ToolCall<string, any>> {
  const promises: Promise<Proposal<any>>[] = [];

  promises.push(new DomAnalyst(llms.fast).proposeAction(state));

  if (lastError) {
    promises.push(
      new HistoryAnalyst(llms.fast).proposeAction(state, lastError),
    );
  }

  const results = await Promise.allSettled(promises);
  const proposals: Proposal<any>[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      proposals.push(result.value);
    } else {
      console.warn(`アナリストの実行に失敗: ${result.reason}`);
    }
  }

  if (
    process.env.AGENT_MODE === "vision" &&
    (proposals[0]?.requiresVision || lastError)
  ) {
    try {
      const visionProposal = await new VisionAnalyst(
        llms.highPerformance,
      ).proposeAction(state);
      proposals.push(visionProposal);
    } catch (error) {
      console.warn(`Vision分析に失敗: ${error}`);
    }
  }

  if (proposals.length === 0) {
    throw new Error("すべてのアナリストが提案の生成に失敗しました");
  }

  if (proposals.length === 1) {
    return proposals[0].toolCall;
  }

  // TODO: Implement synthesizeProposals with a medium model
  console.log("  ...複数の提案を統合中...");
  proposals.forEach((p) =>
    console.log(`    - [${p.confidence.toFixed(2)}] ${p.justification}`),
  );
  return proposals.reduce((prev, current) =>
    prev.confidence > current.confidence ? prev : current,
  ).toolCall;
}

/**
 * 単一のサブゴールを達成するための実行ループ。
 * @param subgoal - 実行するサブゴール。
 * @param stagehand - Stagehandインスタンス。
 * @param state - エージェントの状態。
 * @param originalTask - ユーザーの初期タスク。
 * @param llms - LLMインスタンス群。
 * @param options - 実行オプション。
 * @param options.maxLoopsPerSubgoal - ループの最大試行回数。
 * @param options.approvalCallback - ユーザー承認のためのコールバック関数。
 * @returns サブゴールが成功した場合はtrue、失敗した場合はfalse。
 */
async function executeSubgoalLoop<TArgs = unknown>(
  subgoal: Subgoal,
  stagehand: Stagehand,
  state: AgentState,
  originalTask: string,
  llms: LlmInstances,
  options: {
    maxLoopsPerSubgoal?: number;
    approvalCallback: ApprovalCallback<TArgs>;
  },
): Promise<boolean> {
  const { maxLoopsPerSubgoal: maxLoops = 15, approvalCallback } = options;
  const failureTracker = new FailureTracker();
  let lastError: Error | undefined;

  for (let i = 0; i < maxLoops; i++) {
    console.log(`\n--- [サブゴールループ ${i + 1}/${maxLoops}] ---`);

    let toolCall: ToolCall<string, any>;
    try {
      toolCall = await runAnalystSwarm(subgoal, state, llms, lastError);
      lastError = undefined;
    } catch (e: any) {
      // プラン生成段階での失敗は再計画にエスカレーション
      throw new ReplanNeededError(
        "Analyst swarm failed to produce a plan.",
        e instanceof Error ? e : new Error(String(e)),
        { toolName: "analyst-swarm", args: { subgoal: subgoal.description } } as ToolCall<string, any>,
      );
    }

    const approvedPlan = await approvalCallback([
      toolCall as ToolCall<string, TArgs>,
    ]);
    if (!approvedPlan || approvedPlan.length === 0) {
      throw new ReplanNeededError(
        "User rejected the plan.",
        new Error("Plan rejected by user"),
        toolCall,
      );
    }
    const approvedToolCall = approvedPlan[0];

    try {
      const tool = toolRegistry.get(approvedToolCall.toolName);
      if (!tool)
        throw new Error(`不明なツールです: ${approvedToolCall.toolName}`);

      const parsedArgs = tool.schema.parse(approvedToolCall.args);
      const safeArgs = maskSensitive(parsedArgs as Record<string, unknown>);
      logAgentMessage(
        "Executor",
        `ツールを実行します: ${approvedToolCall.toolName}(${JSON.stringify(safeArgs)})`,
      );

      const result = await tool.execute(
        state,
        parsedArgs,
        llms.highPerformance,
        originalTask,
      );
      state.addHistory({ toolCall: approvedToolCall, result });
      failureTracker.recordSuccess(); // 成功を記録

      const qaResult = await qaAgent(subgoal, state, llms.fast);
      if (qaResult.isSuccess) {
        return true;
      } else {
        state.addQAFailureFeedback(qaResult.reasoning);
        // QA失敗も失敗とみなし、failureTrackerに記録する
        await failureTracker.recordFailure(
          approvedToolCall,
          state,
        );
      }
    } catch (error: any) {
      lastError = error;
      state.addHistory({ toolCall: approvedToolCall, error: error.message });

      await failureTracker.recordFailure(approvedToolCall, state);
      if (failureTracker.isStuck()) {
        const failureContext = failureTracker.getFailureContext();
        throw new ReplanNeededError(
          "Agent appears to be stuck in a loop.",
          error,
          approvedToolCall,
          failureContext,
        );
      }

      const summary = await state
        .getActivePage()
        .extract()
        .then((e) => e.page_text?.substring(0, 2000) || "ページ情報なし")
        .catch(() => "ページ情報なし");
      const reflectionPrompt = getReflectionPrompt(
        originalTask,
        error,
        approvedToolCall.args,
        state,
        summary,
      );
      const { object: reflection } = await generateObjectWithRetry({
        model: llms.fast,
        schema: reflectionSchema,
        prompt: reflectionPrompt,
      });
      const formattedReflection = formatReflection(reflection);
      state.addToWorkingMemory(formattedReflection);
    }
  }
  return false;
}

/**
 * 現場監督として、単一のマイルストーンの達成を指揮します。
 * @param milestone - 達成すべきマイルストーン。
 * @param stagehand - Stagehandインスタンス。
 * @param state - エージェントの状態。
 * @param originalTask - ユーザーの初期タスク。
 * @param llms - LLMインスタンス群。
 * @param options - 実行オプション。
 * @param options.isTestEnvironment - テスト環境で実行されているかどうか。
 * @param options.maxLoopsPerSubgoal - 各サブゴールの最大試行回数。
 * @param options.tools - 利用可能なツールのリスト。
 * @param options.approvalCallback - ユーザー承認のためのコールバック関数。
 * @returns マイルストーンが成功したかどうか。
 */
export async function subgoalCoordinator<TArgs = unknown>(
  milestone: Milestone,
  stagehand: Stagehand,
  state: AgentState,
  originalTask: string,
  llms: LlmInstances,
  options: {
    isTestEnvironment?: boolean;
    maxLoopsPerSubgoal?: number;
    tools?: CustomTool<z.AnyZodObject, TArgs>[];
    approvalCallback: ApprovalCallback<TArgs>;
  },
): Promise<boolean> {
  const tacticalPlan = await elaborateMilestone(milestone, state, llms.fast);
  state.enqueuePlan(tacticalPlan);

  if (process.env.AGENT_MODE === "vision") {
    await setupGlobalEventHandlers(stagehand, llms.highPerformance);
  }

  while (!state.isQueueEmpty()) {
    const subgoal = state.dequeueSubgoal();
    if (!subgoal) continue;

    console.log(`\n▶️ サブゴール実行中: "${subgoal.description}"`);
    // setCurrentSubgoalはdequeueSubgoal内で呼ばれるようになった
    const historyStartIndex = state.getHistory().length;

    const subgoalSuccess = await executeSubgoalLoop(
      subgoal,
      stagehand,
      state,
      originalTask,
      llms,
      {
        maxLoopsPerSubgoal: options.maxLoopsPerSubgoal,
        approvalCallback: options.approvalCallback,
      },
    );
    if (!subgoalSuccess) {
      console.error(
        `サブゴール "${subgoal.description}" の達成に失敗しました。マイルストーンの実行を中断します。`,
      );
      return false;
    }

    try {
      await updateMemoryAfterSubgoal(
        state,
        llms.fast,
        originalTask,
        subgoal,
        historyStartIndex,
      );
      const progress = await checkTaskProgress(originalTask, state, llms.fast);
      if (progress.is_success) {
        console.log(
          `✅ タスクはサブゴール "${subgoal.description}" 完了時点で達成されたと判断しました。`,
        );
        state.clearTaskQueue(); // 残りのサブゴールをクリアして早期完了
        break; // マイルストーンのループを抜ける
      }
    } catch (e: any) {
      console.warn(
        `サブゴール完了後の処理でエラーが発生しました（継続します）: ${e.message}`,
      );
    }
  }

  console.log(
    `✅ マイルストーン "${milestone.description}" の全サブゴールを達成しました。`,
  );
  return true;
}

/**
 * QA Agent: サブゴールの成功条件を検証します。
 * @param subgoal - 検証対象のサブゴール。
 * @param state - エージェントの状態。
 * @param llm - 使用する言語モデル。
 * @returns 検証結果。
 */
async function qaAgent(
  subgoal: Subgoal,
  state: AgentState,
  llm: LanguageModel,
): Promise<{ isSuccess: boolean; reasoning: string }> {
  logAgentMessage(
    "QA",
    `サブゴールの成功条件「${subgoal.successCriteria}」を検証中...`,
  );
  const summary = await state
    .getActivePage()
    .extract()
    .then((e) => e?.page_text?.substring(0, 2000) || "ページ情報なし")
    .catch(() => "ページ情報なし");
  const context = await formatContext(state, summary);
  const prompt = getQAPrompt(subgoal, context);

  const { object: qaResult } = await generateObjectWithRetry({
    model: llm,
    schema: qaSchema,
    prompt,
  });

  if (qaResult.isSuccess) {
    logAgentMessage("QA", `検証成功: ${qaResult.reasoning}`);
  } else {
    logAgentMessage("QA-Fail", `検証失敗: ${qaResult.reasoning}`);
  }

  return qaResult;
}

/**
 * タスク全体の進捗を評価し、早期完了が可能か判断します。
 * @param originalTask - ユーザーの初期タスク。
 * @param state - 現在のエージェントの状態。
 * @param llm - 評価に使用する言語モデル。
 * @returns 評価結果。
 */
async function checkTaskProgress(
  originalTask: string,
  state: AgentState,
  llm: LanguageModel,
): Promise<AgentExecutionResult> {
  console.log("🕵️‍♂️ タスク全体の進捗を評価中...");
  const historySummary = JSON.stringify(state.getHistory().slice(-3));
  let currentUrl = "about:blank";
  try {
    currentUrl = state.getActivePage().url();
  } catch {
    // ページが存在しない場合などは無視
  }
  const evalPrompt = getProgressEvaluationPrompt(
    originalTask,
    historySummary,
    currentUrl,
  );

  const { object: progress } = await generateObjectWithRetry({
    model: llm,
    schema: progressEvaluationSchema,
    prompt: evalPrompt,
  });

  return {
    is_success: progress.isTaskCompleted,
    reasoning: progress.reasoning,
  };
}
