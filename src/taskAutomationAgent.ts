/**
 * @file 高レベルなタスクを自律的に計画・実行するAIエージェント機能を提供します。
 * このバージョンは、Vercel AI SDKを利用してGoogle Gemini, Groq, OpenRouterを動的に切り替え可能です。
 * アーキテクチャを「ツール呼び出しモード」に移行し、信頼性と拡張性を向上させています。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { CoreMessage, LanguageModel, generateText, generateObject } from "ai";
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

// LLMインスタンスを生成するヘルパー関数
export function getLlmInstance(): LanguageModel {
    const agentMode = process.env.AGENT_MODE || 'text';
    const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';

    if (LLM_PROVIDER === 'groq') {
        const groqApiKey = process.env.GROQ_API_KEY;
        if (!groqApiKey) throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
        const groq = createGroq({ apiKey: groqApiKey });
        // Groqは現在Vision非対応のため、モードに関わらずテキストモデルを使用
        return groq(process.env.GROQ_MODEL || '');
    } else if (LLM_PROVIDER === 'openrouter') {
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEYが.envファイルに設定されていません。");
        const openrouter = createOpenAI({
            apiKey: openRouterApiKey,
            baseURL: "https://openrouter.ai/api/v1",
            headers: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Stagehand Agent Console' }
        });
        const modelName = agentMode === 'vision'
            ? ''
            : process.env.OPENROUTER_MODEL || '';
        return openrouter(modelName);
    } else { // google
        const googleApiKey = process.env.GOOGLE_API_KEY;
        if (!googleApiKey) throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
        const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
        const modelName = agentMode === 'vision'
            ? ''
            : process.env.GEMINI_MODEL || '';
        return google(modelName);
    }
}

async function setupGlobalEventHandlers(stagehand: Stagehand, llm: LanguageModel) {
  stagehand.page.context().on('page', async (newPage) => {
    try {
      console.log(`\n🚨 新しいページ/ポップアップが検出されました: ${await newPage.title()}`);
      await newPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      
      const screenshotBuffer = await newPage.screenshot();
      const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;

      const popupAnalysisSchema = z.object({
        isUnwantedPopup: z.boolean().describe("これが広告、クッキー同意、またはメインタスクを妨げる不要なポップアップであればtrue"),
        reasoning: z.string(),
      });

      const { object: analysis } = await generateObject({
        model: llm,
        schema: popupAnalysisSchema,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: "この新しいページは、メインのタスクを妨げる不要なポップアップ（広告、クッキー同意など）ですか？" },
            { type: 'image', image: new URL(screenshotDataUrl) },
          ],
        }],
      });

      if (analysis.isUnwantedPopup) {
        console.log(`  ...不要なポップアップと判断しました。理由: ${analysis.reasoning}。自動的に閉じます。`);
        await newPage.close();
      } else {
        console.log(`  ...メインタスクに関連するページと判断しました。理由: ${analysis.reasoning}`);
      }
    } catch (e: any) {
      console.warn(`ポップアップハンドラでエラーが発生しました: ${e.message}`);
    }
  });
}

/**
 * 実行エージェントとして、与えられたサブゴールを達成します。
 * @param subgoal - 司令塔エージェントから与えられた現在のサブゴール
 * @param stagehand - Stagehandのインスタンス
 * @param state - セッション全体で共有されるエージェントの状態
 * @param originalTask - ユーザーが最初に与えた高レベルなタスク
 * @returns サブゴールの達成に成功した場合はtrue、失敗した場合はfalse
 */
export async function taskAutomationAgent(
    subgoal: string, 
    stagehand: Stagehand,
    state: AgentState,
    originalTask: string
): Promise<boolean> {
    const maxLoops = 15;
    const llm = getLlmInstance();

    if (process.env.AGENT_MODE === 'vision') {
        await setupGlobalEventHandlers(stagehand, llm);
    }

    const messages: CoreMessage[] = [
        { role: 'system', content: getBasePrompt() },
        { role: 'user', content: `最終目標: ${originalTask}\n現在のサブゴール: ${subgoal}` },
    ];

    for (let i = 0; i < maxLoops; i++) {
        console.log(`\n[ループ ${i + 1}] 🧠 AIが次の行動を思考中...`);

        const summary = await state.getActivePage().extract().then(e => e?.page_text?.substring(0, 2000) || "ページ情報なし").catch(() => "ページ情報なし");
        const contextPrompt = await formatContext(state, summary);
        
        const { toolCalls, text, finishReason } = await generateText({
            model: llm,
            messages: [...messages, { role: 'user', content: contextPrompt }],
            tools: availableTools.reduce((acc, tool) => {
                acc[tool.name] = { description: tool.description, parameters: tool.schema };
                return acc;
            }, {} as any),
        });

        if (finishReason === 'stop' && text) {
            console.log(`\n🎉 サブゴール完了！ AIの所感: ${text}`);
            await generateAndSaveSkill(state.getHistory(), llm);
            return true;
        }

        if (!toolCalls || toolCalls.length === 0) {
            console.log("🤔 AIがツールを呼び出しませんでした。サブゴールを完了とみなします。");
            return true;
        }

        const approvedPlan = await requestUserApproval(state, toolCalls);
        if (!approvedPlan) {
            console.log("ユーザーが計画を拒否しました。サブゴールの実行を中断します。");
            return false;
        }

        messages.push({ role: 'assistant', content: approvedPlan.map(tc => ({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args })) });

        const toolResults = await Promise.all(
            approvedPlan.map(async (toolCall) => {
                const tool = toolRegistry.get(toolCall.toolName);
                if (!tool) {
                    const errorMsg = `不明なツールです: ${toolCall.toolName}`;
                    console.error(`  ❌ エラー: ${errorMsg}`);
                    state.addHistory({ toolCall, error: errorMsg });
                    return { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result: `エラー: ${errorMsg}` };
                }
                try {
                    const { toolName, args } = toolCall;
                    console.log(`  ⚡️ 実行中: ${toolName}(${JSON.stringify(args)})`);
                    
                    const result = await tool.execute(state, args, llm, originalTask);
                    
                    const resultLog = typeof result === 'object' ? JSON.stringify(result, null, 2) : result;
                    console.log(`  ✅ 成功: ${resultLog.substring(0, 200)}...`);
                    
                    state.addHistory({ toolCall, result });
                    return { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result };
                } catch (error: any) {
                    console.error(`  ❌ エラー (${toolCall.toolName}): ${error.message}`);
                    state.addHistory({ toolCall, error: error.message });
                    return { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result: `エラー: ${error.message}` };
                }
            })
        );
        
        for (const toolResult of toolResults) {
            if (toolResult.toolName === 'finish' && typeof toolResult.result === 'string' && toolResult.result.startsWith('SELF_EVALUATION_COMPLETE')) {
                return true; // finishが呼ばれたら成功とみなす
            }
        }

        messages.push({ role: 'tool', content: toolResults.map(tr => ({ type: 'tool-result', toolCallId: tr.toolCallId, toolName: tr.toolName, result: tr.result })) });
        
        await state.updatePages();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.warn(`⚠️ 最大試行回数（${maxLoops}回）に達したため、処理を中断しました。`);
    return false;
}
