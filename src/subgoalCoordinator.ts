/**
 * @file 実行エージェントチームを統括するSubgoal Coordinatorの機能を提供します。
 * このコーディネーターは、司令塔から与えられたサブゴールを達成するために、
 * 分析、実行、検証、自己修復のループを専門エージェントチームを率いて実行します。
 */

import { Stagehand, Page } from "@browserbasehq/stagehand";
import { CoreMessage, LanguageModel, Tool, ToolCall } from "ai";
import { z } from "zod";

import { AgentState } from "@/src/agentState";
import { getBasePrompt } from "@/src/prompts/base";
import { formatContext } from "@/src/prompts/context";
import { availableTools, toolRegistry } from "@/src/tools/index";
import {
  CustomTool,
  ApprovalCallback,
  Subgoal,
  reflectionSchema,
} from "@/src/types";
import { InvalidToolArgumentError } from "@/src/errors";
import {
  generateTextWithRetry,
  generateObjectWithRetry,
} from "@/src/utils/llm";
import { getAnalystPrompt } from "@/src/prompts/analyst";
import { getQAPrompt, qaSchema } from "@/src/prompts/qa";
import { logAgentMessage } from "@/src/utils/ui";
import { getReflectionPrompt, formatReflection } from "./prompts/reflection";

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
 * 再計画が必要であることを示すためのカスタムエラー
 */
class ReplanNeededError extends Error {
  public originalError: Error;
  public failedToolCall: ToolCall<string, unknown>;

  constructor(
    message: string,
    originalError: Error,
    failedToolCall: ToolCall<string, unknown>,
  ) {
    super(message);
    this.name = "ReplanNeededError";
    this.originalError = originalError;
    this.failedToolCall = failedToolCall;
  }
}

/**
 * プロジェクトで定義されたカスタムツール形式を、Vercel AI SDKが要求する形式に変換します。
 * @param tools - プロジェクト独自のカスタムツールの配列。
 * @returns Vercel AI SDKの`generateText`関数に渡すためのツールオブジェクト。
 */
function mapCustomToolsToAITools<TSchema extends z.AnyZodObject>(
  tools: ReadonlyArray<CustomTool<TSchema, unknown>>,
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
      // ページが読み込まれるのを待つ
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

      // Visionモデルにスクリーンショットを渡し、ポップアップが不要かどうかを判断させる
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
 * Analyst Agent: 次に実行すべき単一のアクションを計画します。
 * @param subgoal - 現在のサブゴール。
 * @param state - エージェントの状態。
 * @param llm - 使用する言語モデル。
 * @param tools - 利用可能なツールのリスト。
 * @param messages - これまでの対話履歴。
 * @returns 計画された単一のツール呼び出し。
 */
async function analystAgent(
  subgoal: Subgoal,
  state: AgentState,
  llm: LanguageModel,
  tools: ReadonlyArray<CustomTool<any, any>>,
  messages: CoreMessage[],
): Promise<ToolCall<string, any>> {
  logAgentMessage("Analyst", "次のアクションを計画中...");
  const summary = await state
    .getActivePage()
    .extract()
    .then((e) => e?.page_text?.substring(0, 2000) || "ページ情報なし")
    .catch(() => "ページ情報なし");
  const context = await formatContext(state, summary);
  const prompt = getAnalystPrompt(subgoal, context);

  const { toolCalls } = await generateTextWithRetry({
    model: llm,
    messages: [...messages, { role: "user", content: prompt }],
    tools: mapCustomToolsToAITools(tools),
  });

  if (!toolCalls || toolCalls.length === 0) {
    throw new Error("Analyst Agentがアクションを計画できませんでした。");
  }

  const toolCall = toolCalls[0];
  logAgentMessage(
    "Analyst",
    `計画を立案しました: ${toolCall.toolName}(${JSON.stringify(toolCall.args)})`,
  );
  return toolCall;
}

/**
 * Executor Agent: 計画されたアクションを実行します。
 * @param toolCall - 実行するツール呼び出し。
 * @param state - エージェントの状態。
 * @param llm - 使用する言語モデル。
 * @param originalTask - ユーザーの初期タスク。
 * @returns ツールの実行結果。
 */
async function executorAgent<TArgs>(
  toolCall: ToolCall<string, TArgs>,
  state: AgentState,
  llm: LanguageModel,
  originalTask: string,
): Promise<any> {
  const tool = toolRegistry.get(toolCall.toolName);
  if (!tool) {
    throw new Error(`不明なツールです: ${toolCall.toolName}`);
  }

  const parsedArgs = tool.schema.parse(toolCall.args);

  if (tool.precondition) {
    const check = await tool.precondition(state, parsedArgs);
    if (!check.success) {
      throw new InvalidToolArgumentError(
        `事前条件チェック失敗: ${check.message}`,
        toolCall.toolName,
        parsedArgs,
      );
    }
  }

  const safeArgs = maskSensitive(parsedArgs as Record<string, unknown>);
  logAgentMessage(
    "Executor",
    `ツールを実行します: ${toolCall.toolName}(${JSON.stringify(safeArgs)})`,
  );

  const result = await tool.execute(state, parsedArgs, llm, originalTask);

  const resultLog =
    typeof result === "object" ? JSON.stringify(result, null, 2) : result;
  logAgentMessage(
    "Executor",
    `実行成功: ${String(resultLog).substring(0, 200)}...`,
  );

  state.addHistory({ toolCall, result });
  return result;
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
 * 実行エージェントチームを統括し、与えられたサブゴールを達成するためのループを実行します。
 * @param subgoal - 達成すべきサブゴール。
 * @param stagehand - Stagehandインスタンス。
 * @param state - エージェントの状態。
 * @param originalTask - ユーザーの初期タスク。
 * @param llm - 使用する言語モデル。
 * @param options - 実行オプション。
 * @param options.isTestEnvironment
 * @param options.maxLoops
 * @param options.tools
 * @param options.toolRegistry
 * @param options.approvalCallback
 * @returns サブゴールが成功したかどうか。
 */
export async function subgoalCoordinator<TArgs = unknown>(
  subgoal: Subgoal,
  stagehand: Stagehand,
  state: AgentState,
  originalTask: string,
  llm: LanguageModel,
  options: {
    isTestEnvironment?: boolean;
    maxLoops?: number;
    tools?: CustomTool<z.AnyZodObject, TArgs>[];
    toolRegistry?: Map<string, CustomTool<z.AnyZodObject, TArgs>>;
    approvalCallback: ApprovalCallback<TArgs>;
  },
): Promise<boolean> {
  const {
    isTestEnvironment = false,
    maxLoops = 15,
    tools = availableTools,
    approvalCallback,
  } = options;

  let reflectionCount = 0;
  const maxReflections = 2;
  let qaFailCount = 0;
  const MAX_QA_FAILS = 3;

  state.clearWorkingMemory();
  state.setCurrentSubgoal(subgoal);

  if (process.env.AGENT_MODE === "vision") {
    await setupGlobalEventHandlers(stagehand, llm);
  }

  const messages: CoreMessage[] = [
    { role: "system", content: getBasePrompt(isTestEnvironment) },
    {
      role: "user",
      content: `最終目標: ${originalTask}\n現在のサブゴール: ${subgoal.description}`,
    },
  ];

  for (let i = 0; i < maxLoops; i++) {
    console.log(`\n--- [ループ ${i + 1}/${maxLoops}] ---`);

    // 1. Analyst Agentが計画
    const toolCall = await analystAgent(subgoal, state, llm, tools, messages);

    // 2. 承認
    const approvedPlan = await approvalCallback([
      toolCall as ToolCall<string, TArgs>,
    ]);
    if (!approvedPlan || approvedPlan.length === 0) {
      throw new ReplanNeededError(
        "ユーザーが計画を拒否しました。",
        new Error("Plan rejected by user"),
        toolCall,
      );
    }
    const approvedToolCall = approvedPlan[0];

    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: approvedToolCall.toolCallId,
          toolName: approvedToolCall.toolName,
          args: approvedToolCall.args,
        },
      ],
    });

    // 3. Executorが実行
    try {
      const result = await executorAgent(
        approvedToolCall,
        state,
        llm,
        originalTask,
      );
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: approvedToolCall.toolCallId,
            toolName: approvedToolCall.toolName,
            result,
          },
        ],
      });
      reflectionCount = 0; // 成功したらリセット
    } catch (error: any) {
      logAgentMessage("Executor", `実行エラー: ${error.message}`);
      state.addHistory({ toolCall: approvedToolCall, error: error.message });
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: approvedToolCall.toolCallId,
            toolName: approvedToolCall.toolName,
            result: `エラー: ${error.message}`,
          },
        ],
      });

      reflectionCount++;
      if (reflectionCount > maxReflections) {
        throw new ReplanNeededError(
          "自己修復の制限に達しました。",
          error,
          approvedToolCall,
        );
      }

      // Reflection (自己修復)
      const summary = await state
        .getActivePage()
        .extract()
        .then((e) => e?.page_text?.substring(0, 2000) || "ページ情報なし")
        .catch(() => "ページ情報なし");
      const reflectionPrompt = getReflectionPrompt(
        originalTask,
        error,
        approvedToolCall.args,
        state,
        summary,
      );
      const { object: reflection } = await generateObjectWithRetry({
        model: llm,
        schema: reflectionSchema,
        prompt: reflectionPrompt,
      });
      const formattedReflection = formatReflection(reflection);
      messages.push({ role: "user", content: formattedReflection });
      continue;
    }

    // 4. QA Agentが検証
    const qaResult = await qaAgent(subgoal, state, llm);
    if (qaResult.isSuccess) {
      return true; // サブゴール完了
    } else {
      qaFailCount++;
      state.addQAFailureFeedback(qaResult.reasoning);
      messages.push({
        role: "user",
        content: `[検証失敗] 理由: ${qaResult.reasoning}`,
      });
      if (qaFailCount >= MAX_QA_FAILS) {
        logAgentMessage(
          "Orchestrator",
          `QA検証の失敗が上限 (${MAX_QA_FAILS}回) に達しました。`,
        );
        throw new ReplanNeededError(
          "QA検証の失敗が上限に達しました。",
          new Error(qaResult.reasoning),
          toolCall,
        );
      }
    }
  }
  return false;
}
