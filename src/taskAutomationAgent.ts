/**
 * @file 実行エージェント(Task Automation Agent)の機能を提供します。
 * このエージェントは、司令塔から与えられたサブゴールを達成するために、
 * 思考、ツール選択、実行、検証、自己修復のループを実行します。
 * Vercel AI SDKを利用して、Google Gemini, Groq, OpenRouterなどのLLMを動的に切り替え可能です。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import {
  CoreMessage,
  LanguageModel,
  generateText,
  generateObject,
  Tool,
} from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import { AgentState } from "./agentState.js";
import { getBasePrompt } from "./prompts/base.js";
import { formatContext } from "./prompts/context.js";
import { availableTools, toolRegistry } from "./tools/index.js";
import { requestUserApproval } from "./debugConsole.js";
import { generateAndSaveSkill } from "./skillManager.js";
import { CustomTool } from "./types.js";
import { eventHub } from "./eventHub.js";
import { LogPayload } from "../types/protocol.js";

/**
 * プロジェクトで定義されたカスタムツール形式を、Vercel AI SDKが要求する形式に変換します。
 * @param tools - プロジェクト独自のカスタムツールの配列。
 * @returns Vercel AI SDKの`generateText`関数に渡すためのツールオブジェクト。
 */
function mapCustomToolsToAITools(tools: CustomTool[]): Record<string, Tool> {
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
 * 環境変数に基づいて、適切なLLMクライアントのインスタンスを生成して返します。
 * @returns Vercel AI SDKの`LanguageModel`インスタンス。
 * @throws {Error} 必要なAPIキーが.envファイルに設定されていない場合にエラーをスローします。
 */
export function getLlmInstance(): LanguageModel {
  const agentMode = process.env.AGENT_MODE || "text";
  const LLM_PROVIDER = process.env.LLM_PROVIDER || "google";

  if (LLM_PROVIDER === "groq") {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey)
      throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
    const groq = createGroq({ apiKey: groqApiKey });
    // Groqは現在Vision非対応のため、モードに関わらずテキストモデルを使用
    return groq(process.env.GROQ_MODEL || "");
  } else if (LLM_PROVIDER === "openrouter") {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey)
      throw new Error("OPENROUTER_API_KEYが.envファイルに設定されていません。");
    const openrouter = createOpenAI({
      apiKey: openRouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Stagehand Agent Console",
      },
    });
    const modelName =
      agentMode === "vision"
        ? "" // Visionモードの場合、モデル名をOpenAIクライアントに任せる
        : process.env.OPENROUTER_MODEL || "";
    return openrouter(modelName);
  } else {
    // google
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey)
      throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    const modelName =
      agentMode === "vision"
        ? process.env.GEMINI_MODEL || "" // 現状のモデルは、すべて画像認識に対応しているため、このように記述
        : process.env.GEMINI_MODEL || "";
    return google(modelName);
  }
}

/**
 * 新しいページ（ポップアップなど）が開かれた際のグローバルイベントハンドラを設定します。
 * Visionモデルを使用し、不要なポップアップ（広告、クッキー同意など）を自動で閉じます。
 * @param stagehand - Stagehandのインスタンス。
 * @param llm - Vision分析に使用する言語モデルのインスタンス。
 */
async function setupGlobalEventHandlers(
  stagehand: Stagehand,
  llm: LanguageModel,
) {
  stagehand.page.context().on("page", async (newPage) => {
    try {
      const message = `\n🚨 新しいページ/ポップアップが検出されました: ${await newPage.title()}`;
      eventHub.emit("agent:log", {
        level: "system",
        message,
        timestamp: new Date().toISOString(),
      });

      // ページが読み込まれるのを待つ
      await newPage
        .waitForLoadState("domcontentloaded", { timeout: 5000 })
        .catch(() => {});

      const screenshotBuffer = await newPage.screenshot();
      const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer.toString(
        "base64",
      )}`;

      const popupAnalysisSchema = z.object({
        isUnwantedPopup: z
          .boolean()
          .describe(
            "これが広告、クッキー同意、またはメインタスクを妨げる不要なポップアップであればtrue",
          ),
        reasoning: z.string(),
      });

      // Visionモデルにスクリーンショットを渡し、ポップアップが不要かどうかを判断させる
      const { object: analysis } = await generateObject({
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
        const logMessage = `  ...不要なポップアップと判断しました。理由: ${analysis.reasoning}。自動的に閉じます。`;
        eventHub.emit("agent:log", {
          level: "system",
          message: logMessage,
          timestamp: new Date().toISOString(),
        });
        await newPage.close();
      } else {
        const logMessage = `  ...メインタスクに関連するページと判断しました。理由: ${analysis.reasoning}`;
        eventHub.emit("agent:log", {
          level: "system",
          message: logMessage,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      eventHub.emit("agent:log", {
        level: "warn",
        message: `ポップアップハンドラでエラーが発生しました: ${e.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

/**
 * 実行エージェントとして、与えられたサブゴールを達成するための思考と行動のループを実行します。
 * @param subgoal - 司令塔エージェントから与えられた現在のサブゴール。
 * @param stagehand - Stagehandのインスタンス。
 * @param state - セッション全体で共有されるエージェントの状態。
 * @param originalTask - ユーザーが最初に与えた高レベルなタスク。
 * @param options - テスト環境用の設定などを含むオプション。
 * @param options.isTestEnvironment
 * @param options.maxLoops
 * @param options.tools
 * @param options.toolRegistry
 * @returns サブゴールの達成に成功した場合はtrue、失敗した場合はfalse。
 */
export async function taskAutomationAgent(
  subgoal: string,
  stagehand: Stagehand,
  state: AgentState,
  originalTask: string,
  options: {
    isTestEnvironment?: boolean;
    maxLoops?: number;
    tools?: CustomTool[];
    toolRegistry?: Map<string, CustomTool>;
  } = {},
): Promise<boolean> {
  const {
    isTestEnvironment = false,
    maxLoops = 15,
    tools = availableTools,
    toolRegistry: customToolRegistry = toolRegistry,
  } = options;

  // // isGuiModeフラグを追加。isTestEnvironmentはGUIを持たないため、GUIモードではない。
  // const isGuiMode = process.argv.includes("--no-cui") && !isTestEnvironment;

  const llm = getLlmInstance();

  /**
   * ログをCUIとGUIの両方に送信するためのヘルパー関数。
   * @param message - ログメッセージ。
   * @param level - ログの重要度レベル。
   */
  const log = (
    message: string,
    level: LogPayload["level"] = "info",
  ) => {
    eventHub.emit("agent:log", {
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  };

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
    log(`\n[ループ ${i + 1}] 🧠 AIが次の行動を思考中...`, "system");

    // 1. 状況認識: 現在のページ情報を収集
    const summary = await state
      .getActivePage()
      .extract()
      .then((e) => e?.page_text?.substring(0, 2000) || "ページ情報なし")
      .catch(() => "ページ情報なし");
    const contextPrompt = await formatContext(state, summary);

    // 2. 思考: LLMに次の行動（ツール呼び出し）を決定させる
    const { toolCalls, text, finishReason } = await generateText({
      model: llm,
      messages: [...messages, { role: "user", content: contextPrompt }],
      tools: mapCustomToolsToAITools(tools),
    });

    // サブゴール完了と判断した場合
    if (finishReason === "stop" && text) {
      log(`\n🎉 サブゴール完了！ AIの所感: ${text}`, "system");
      // テスト環境でなければ、行動履歴から新しいスキルを生成しようと試みる
      if (!isTestEnvironment) {
        await generateAndSaveSkill(state.getHistory(), llm);
      }
      return true;
    }

    if (!toolCalls || toolCalls.length === 0) {
      log(
        "🤔 AIがツールを呼び出しませんでした。サブゴールを完了とみなします。",
        "system",
      );
      return true;
    }

    // 3. 承認: ユーザーに計画の実行許可を求める（介入モードによる）
    const approvedPlan = isTestEnvironment
      ? toolCalls
      : await requestUserApproval(state, toolCalls);
    if (!approvedPlan) {
      log(
        "ユーザーが計画を拒否しました。サブゴールの実行を中断します。",
        "warn",
      );
      return false;
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

    const toolResults = await Promise.all(
      approvedPlan.map(async (toolCall) => {
        const tool = customToolRegistry.get(toolCall.toolName);
        if (!tool) {
          const errorMsg = `不明なツールです: ${toolCall.toolName}`;
          log(`❌ エラー: ${errorMsg}`, "error");
          state.addHistory({ toolCall, error: errorMsg });
          return {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result: `エラー: ${errorMsg}`,
          };
        }
        try {
          const { toolName, args } = toolCall;
          log(`⚡️ 実行中: ${toolName}(${JSON.stringify(args)})`);

          const result = await tool.execute(state, args, llm, originalTask);

          const resultLog =
            typeof result === "object"
              ? JSON.stringify(result, null, 2)
              : result;
          log(`✅ 成功: ${resultLog.substring(0, 200)}...`);

          state.addHistory({ toolCall, result });
          return {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result,
          };
        } catch (error: any) {
          log(`❌ エラー (${toolCall.toolName}): ${error.message}`, "error");
          state.addHistory({ toolCall, error: error.message });
          return {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result: `エラー: ${error.message}`,
          };
        }
      }),
    );

    // 5. 検証: finishツールが呼ばれたか確認
    for (const toolResult of toolResults) {
      if (
        toolResult.toolName === "finish" &&
        typeof toolResult.result === "string" &&
        toolResult.result.startsWith("SELF_EVALUATION_COMPLETE")
      ) {
        return true; // finishが呼ばれたらタスク全体が完了したとみなし、成功を返す
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
    await new Promise((resolve) => setTimeout(resolve, 1000)); // ページ遷移後の安定化を待つ
  }

  log(
    `⚠️ 最大試行回数（${maxLoops}回）に達したため、処理を中断しました。`,
    "warn",
  );
  return false;
}
