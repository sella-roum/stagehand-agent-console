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
import { ReflectionResult, reflectionSchema } from "./types.js";
import { getBasePrompt } from "./prompts/base.js";
import { formatContext } from "./prompts/context.js";
import { getReflectionPrompt, formatReflection } from "./prompts/reflection.js";
import { availableTools } from "./tools/index.js";

// --- 各ツールを個別にインポートして、型を明確にする ---
import { gotoTool } from "./tools/goto.js";
import { actTool } from "./tools/act.js";
import { cachedActTool } from "./tools/cached_act.js";
import { extractTool } from "./tools/extract.js";
import { observeTool } from "./tools/observe.js";
import { summarizeTool } from "./tools/summarize.js";
import { writeFileTool, readFileTool } from "./tools/fileSystem.js";
import { newTabTool, switchTabTool, closeTabTool } from "./tools/tabManagement.js";
import { askUserTool } from "./tools/askUser.js";
import { finishTool } from "./tools/finish.js";
import { visionAnalyzeTool, clickAtCoordinatesTool } from "./tools/vision.js";


// LLMインスタンスを生成するヘルパー関数
function getLlmInstance(): LanguageModel {
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

export async function taskAutomationAgent(task: string, stagehand: Stagehand) {
    const state = new AgentState(stagehand);
    const maxLoops = 15;
    const llm = getLlmInstance();

    if (process.env.AGENT_MODE === 'vision') {
        await setupGlobalEventHandlers(stagehand, llm);
    }

    const messages: CoreMessage[] = [
        { role: 'system', content: getBasePrompt() },
        { role: 'user', content: `最終目標: ${task}` },
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
            console.log(`\n🎉 タスク完了！ 最終回答: ${text}`);
            return;
        }

        if (!toolCalls || toolCalls.length === 0) {
            console.log("🤔 AIがツールを呼び出しませんでした。処理を終了します。");
            return;
        }

        messages.push({ role: 'assistant', content: toolCalls.map(tc => ({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args })) });

        const toolResults = await Promise.all(
            toolCalls.map(async (toolCall) => {
                try {
                    const { toolName, args } = toolCall;
                    console.log(`  ⚡️ 実行中: ${toolName}(${JSON.stringify(args)})`);
                    
                    // --- 堅牢なswitch文によるディスパッチ ---
                    let result;
                    switch (toolName) {
                        case 'goto':
                            result = await gotoTool.execute(state, args);
                            break;
                        case 'act':
                            result = await actTool.execute(state, args);
                            break;
                        case 'cached_act':
                            result = await cachedActTool.execute(state, args);
                            break;
                        case 'extract':
                            result = await extractTool.execute(state, args);
                            break;
                        case 'observe':
                            result = await observeTool.execute(state, args);
                            break;
                        case 'summarize':
                            result = await summarizeTool.execute(state, args);
                            break;
                        case 'write_file':
                            result = await writeFileTool.execute(state, args);
                            break;
                        case 'read_file':
                            result = await readFileTool.execute(state, args);
                            break;
                        case 'new_tab':
                            result = await newTabTool.execute(state, args);
                            break;
                        case 'switch_tab':
                            result = await switchTabTool.execute(state, args);
                            break;
                        case 'close_tab':
                            result = await closeTabTool.execute(state, args);
                            break;
                        case 'ask_user':
                            result = await askUserTool.execute(state, args);
                            break;
                        case 'vision_analyze':
                            result = await visionAnalyzeTool.execute(state, args, llm);
                            break;
                        case 'click_at_coordinates':
                            result = await clickAtCoordinatesTool.execute(state, args);
                            break;
                        case 'finish':
                            result = await finishTool.execute(state, args, llm, task);
                            break;
                        default:
                            throw new Error(`不明なツールです: ${toolName}`);
                    }
                    
                    const resultLog = typeof result === 'object' ? JSON.stringify(result, null, 2) : result;
                    console.log(`  ✅ 成功: ${resultLog.substring(0, 200)}...`);
                    
                    return { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result };
                } catch (error: any) {
                    console.error(`  ❌ エラー (${toolCall.toolName}): ${error.message}`);
                    return { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result: `エラー: ${error.message}` };
                }
            })
        );
        
        for (const toolResult of toolResults) {
            if (toolResult.toolName === 'finish' && typeof toolResult.result === 'string' && toolResult.result.startsWith('SELF_EVALUATION_COMPLETE')) {
                return;
            }
        }

        messages.push({ role: 'tool', content: toolResults.map(tr => ({ type: 'tool-result', toolCallId: tr.toolCallId, toolName: tr.toolName, result: tr.result })) });
        
        await state.updatePages();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.warn(`⚠️ 最大試行回数（${maxLoops}回）に達したため、処理を中断しました。`);
}
