/**
 * @file 実行エージェント(Task Automation Agent)の機能を提供します。
 * このエージェントは、司令塔から与えられたサブゴールを達成するために、
 * 思考、ツール選択、実行、検証、自己修復のループを実行します。
 * Vercel AI SDKを利用して、Google Gemini, Groq, OpenRouterなどのLLMを動的に切り替え可能です。
 */

import { Stagehand, Page } from "@browserbasehq/stagehand";
import { CoreMessage, LanguageModel, Tool, ToolCall } from "ai";
import { z } from "zod";

import { AgentState } from "@/src/agentState";
import { getBasePrompt } from "@/src/prompts/base";
import { formatContext } from "@/src/prompts/context";
import { availableTools, toolRegistry } from "@/src/tools/index";
import { generateAndSaveSkill } from "@/src/skillManager";
import { CustomTool, ApprovalCallback } from "@/src/types";
import { InvalidToolArgumentError } from "@/src/errors";
import {
  generateTextWithRetry,
  generateObjectWithRetry,
} from "@/src/utils/llm";

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
              { type: "image", image: screenshotDataUrl },
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
 * 実行エージェントとして、与えられたサブゴールを達成するための思考と行動のループを実行します。
 * @param subgoal - 司令塔エージェントから与えられた現在のサブゴール。
 * @param stagehand - Stagehandのインスタンス。
 * @param state - セッション全体で共有されるエージェントの状態。
 * @param originalTask - ユーザーが最初に与えた高レベルなタスク。
 * @param llm - 使用する言語モデルのインスタンス。
 * @param options - テスト環境用の設定などを含むオプション。
 * @param options.isTestEnvironment
 * @param options.maxLoops
 * @param options.tools
 * @param options.toolRegistry
 * @param options.approvalCallback
 * @returns サブゴールの達成に成功した場合はtrue、失敗した場合はfalse。
 */
export async function taskAutomationAgent<TArgs = unknown>(
  subgoal: string,
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
    toolRegistry: customToolRegistry = toolRegistry,
    approvalCallback,
  } = options;

  let reflectionCount = 0;
  const maxReflections = 2;

  state.clearWorkingMemory();

  // Visionモードが有効な場合、ポップアップを自動処理するイベントハンドラを設定
  if (process.env.AGENT_MODE === "vision") {
    await setupGlobalEventHandlers(stagehand, llm);
  }

  // プロンプトの初期設定
  const messages: CoreMessage[] = [
    { role: "system", content: getBasePrompt(isTestEnvironment) },
    {
      role: "user",
      content: `最終目標: ${originalTask}\n現在のサブゴール: ${subgoal}`,
    },
  ];

  // 思考と行動のメインループ
  for (let i = 0; i < maxLoops; i++) {
    console.log(`\n[ループ ${i + 1}] 🧠 AIが次の行動を思考中...`);

    // 1. 状況認識: 現在のページ情報を収集
    const summary = await state
      .getActivePage()
      .extract()
      .then((e) => e?.page_text?.substring(0, 2000) || "ページ情報なし")
      .catch(() => "ページ情報なし");
    const contextPrompt = await formatContext(state, summary);

    // 2. 思考: LLMに次の行動（ツール呼び出し）を決定させる
    const { toolCalls, text, finishReason } = await generateTextWithRetry({
      model: llm,
      messages: [...messages, { role: "user", content: contextPrompt }],
      tools: mapCustomToolsToAITools(tools),
    });

    // サブゴール完了と判断した場合
    if (finishReason === "stop" && text) {
      console.log(`\n🎉 サブゴール完了！ AIの所感: ${text}`);
      state.addCompletedSubgoal(subgoal);

      if (!isTestEnvironment) {
        await generateAndSaveSkill(state.getHistory(), llm);
      }
      return true;
    }

    if (!toolCalls || toolCalls.length === 0) {
      console.log(
        "🤔 AIがツールを呼び出しませんでした。サブゴールを完了とみなします。",
      );
      return true;
    }

    // 3. 承認: ユーザーに計画の実行許可を求める（介入モードによる）
    let approvedPlan: ToolCall<string, TArgs>[] | null = null;
    try {
      approvedPlan = await approvalCallback(
        toolCalls as ToolCall<string, TArgs>[],
      );
    } catch (error: any) {
      const planSummary =
        toolCalls
          ?.map((tc) => tc.toolName)
          .slice(0, 3)
          .join(", ") || "N/A";
      console.error(
        `承認プロセス中にエラーが発生しました: ${error.message}\n失敗した計画の概要 (先頭3件): ${planSummary}`,
      );
      // 再計画へ
      throw new ReplanNeededError(
        "承認プロセスでエラーが発生しました。",
        error,
        (toolCalls && toolCalls[0]) as ToolCall<string, unknown>,
      );
    }
    if (!approvedPlan || approvedPlan.length === 0) {
      console.log(
        "ユーザーが計画を拒否しました。サブゴールの実行を中断します。",
      );
      // 再計画へ
      throw new ReplanNeededError(
        "ユーザーが計画を拒否しました。",
        new Error("Plan rejected by user"),
        (toolCalls && toolCalls[0]) as ToolCall<string, unknown>,
      );
    }

    // 4. 実行: 承認されたツールを実行し、結果を収集
    messages.push({
      role: "assistant",
      content: approvedPlan.map((tc) => ({
        type: "tool-call",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.args,
      })),
    });

    const toolResults: Array<{
      toolCallId: string;
      toolName: string;
      result: unknown;
    }> = [];
    for (const toolCall of approvedPlan) {
      const tool = customToolRegistry.get(toolCall.toolName);
      if (!tool) {
        const errorMsg = `不明なツールです: ${toolCall.toolName}`;
        console.error(`  ❌ エラー: ${errorMsg}`);
        state.addHistory({ toolCall, error: errorMsg });
        toolResults.push({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          result: `エラー: ${errorMsg}`,
        });
        continue;
      }
      try {
        const { toolName, args } = toolCall;
        // 事前に引数をスキーマで検証して型付け
        const parsedArgs = tool.schema.parse(args);
        if (tool.precondition) {
          console.log(`  ...事前条件をチェック中: ${toolName}`);
          const check = await tool.precondition(state, parsedArgs);
          if (!check.success) {
            throw new InvalidToolArgumentError(
              `事前条件チェック失敗: ${check.message}`,
              toolName,
              parsedArgs,
            );
          }
        }
        const safeArgs = maskSensitive(parsedArgs as Record<string, unknown>);
        console.log(`  ⚡️ 実行中: ${toolName}(${JSON.stringify(safeArgs)})`);
        const result = await tool.execute(state, parsedArgs, llm, originalTask);
        const resultLog =
          typeof result === "object" ? JSON.stringify(result, null, 2) : result;
        console.log(`  ✅ 成功: ${String(resultLog).substring(0, 200)}...`);
        state.addHistory({ toolCall, result });
        toolResults.push({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          result,
        });
      } catch (error: any) {
        reflectionCount++;
        if (reflectionCount > maxReflections) {
          console.warn(
            `⚠️ 自己修復の試行が${maxReflections}回を超えました。司令塔に再計画を要求します。`,
          );
          throw new ReplanNeededError(
            "自己修復の制限に達しました。",
            error,
            toolCall,
          );
        }
        console.error(`  ❌ エラー (${toolCall.toolName}): ${error.message}`);
        state.addHistory({ toolCall, error: error.message });
        toolResults.push({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          result: `エラー: ${error.message}`,
        });
      }
    }

    // 5. 検証: finishツールが呼ばれたか確認
    for (const toolResult of toolResults) {
      if (
        toolResult.toolName === "finish" &&
        typeof toolResult.result === "string" &&
        toolResult.result.startsWith("SELF_EVALUATION_COMPLETE")
      ) {
        return true;
      }
    }

    // 6. 履歴の更新: 実行結果をメッセージ履歴に追加し、次のループへ
    messages.push({
      role: "tool",
      content: toolResults.map((tr) => ({
        type: "tool-result",
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        result: tr.result,
      })),
    });

    await state.updatePages();

    // レートリミットを回避するために、各思考ループの間に短い待機時間を設ける
    const LLM_PROVIDER = process.env.LLM_PROVIDER || "google";
    const defaultWaitMs = LLM_PROVIDER === "groq" ? 3000 : 1000;
    const waitMs = parseInt(
      process.env.LOOP_WAIT_MS || String(defaultWaitMs),
      10,
    );
    console.log(
      `  ...レートリミット対策のため ${waitMs / 1000}秒待機します...`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  console.warn(
    `⚠️ 最大試行回数（${maxLoops}回）に達したため、処理を中断しました。`,
  );
  return false;
}
