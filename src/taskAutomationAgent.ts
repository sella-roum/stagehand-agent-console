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

import { AgentState } from "@/src/agentState";
import { getBasePrompt } from "@/src/prompts/base";
import { formatContext } from "@/src/prompts/context";
import { availableTools, toolRegistry } from "@/src/tools/index";
import { requestUserApproval } from "@/src/debugConsole";
import { generateAndSaveSkill } from "@/src/skillManager";
import { CustomTool } from "@/src/types";
import { InvalidToolArgumentError } from "@/src/errors";
import {
  getMemoryUpdatePrompt,
  memoryUpdateSchema,
} from "@/src/prompts/memory";

/**
 * 再計画が必要であることを示すためのカスタムエラー
 */
class ReplanNeededError extends Error {
  public originalError: Error;
  constructor(message: string, originalError: Error) {
    super(message);
    this.name = "ReplanNeededError";
    this.originalError = originalError;
  }
}

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

  const llm = getLlmInstance();
  const historyStartIndex = state.getHistory().length;
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
    const { toolCalls, text, finishReason } = await generateText({
      model: llm,
      messages: [...messages, { role: "user", content: contextPrompt }],
      tools: mapCustomToolsToAITools(tools),
    });

    // サブゴール完了と判断した場合
    if (finishReason === "stop" && text) {
      console.log(`\n🎉 サブゴール完了！ AIの所感: ${text}`);
      state.addCompletedSubgoal(subgoal);

      console.log("  ...🧠 経験を記憶に整理中...");
      const subgoalHistory = state.getHistory().slice(historyStartIndex);
      const subgoalHistoryJson = JSON.stringify(
        subgoalHistory.map((r) => ({
          toolName: r.toolCall.toolName,
          args: r.toolCall.args,
          result: r.result
            ? String(r.result).substring(0, 200)
            : "N/A",
        })),
      );

      try {
        const { object: memoryUpdate } = await generateObject({
          model: llm,
          prompt: getMemoryUpdatePrompt(
            originalTask,
            subgoal,
            subgoalHistoryJson,
          ),
          schema: memoryUpdateSchema,
        });

        state.addToWorkingMemory(
          `直前のサブゴール「${subgoal}」の要約: ${memoryUpdate.subgoal_summary}`,
        );

        if (memoryUpdate.long_term_memory_facts.length > 0) {
          console.log("  ...📌 長期記憶に新しい事実を追加します。");
          memoryUpdate.long_term_memory_facts.forEach((fact) => {
            state.addToLongTermMemory(fact);
            console.log(`    - ${fact}`);
          });
        }
      } catch (e: any) {
        console.warn(`⚠️ 記憶の整理中にエラーが発生しました: ${e.message}`);
      }

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
    const approvedPlan = isTestEnvironment
      ? toolCalls
      : await requestUserApproval(state, toolCalls);
    if (!approvedPlan) {
      console.log(
        "ユーザーが計画を拒否しました。サブゴールの実行を中断します。",
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
          console.error(`  ❌ エラー: ${errorMsg}`);
          state.addHistory({ toolCall, error: errorMsg });
          return {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result: `エラー: ${errorMsg}`,
          };
        }
        try {
          const { toolName, args } = toolCall;

          if (tool.precondition) {
            console.log(`  ...事前条件をチェック中: ${toolName}`);
            const check = await tool.precondition(state, args);
            if (!check.success) {
              throw new InvalidToolArgumentError(
                `事前条件チェック失敗: ${check.message}`,
                toolName,
                args,
              );
            }
          }

          console.log(`  ⚡️ 実行中: ${toolName}(${JSON.stringify(args)})`);

          const result = await tool.execute(state, args, llm, originalTask);

          const resultLog =
            typeof result === "object"
              ? JSON.stringify(result, null, 2)
              : result;
          console.log(`  ✅ 成功: ${resultLog.substring(0, 200)}...`);

          state.addHistory({ toolCall, result });
          return {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result,
          };
        } catch (error: any) {
          reflectionCount++;
          if (reflectionCount > maxReflections) {
            console.warn(
              `⚠️ 自己修復の試行が${maxReflections}回を超えました。司令塔に再計画を要求します。`,
            );
            throw new ReplanNeededError(
              "自己修復の制限に達しました。",
              error,
            );
          }

          console.error(`  ❌ エラー (${toolCall.toolName}): ${error.message}`);
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.warn(
    `⚠️ 最大試行回数（${maxLoops}回）に達したため、処理を中断しました。`,
  );
  return false;
}
