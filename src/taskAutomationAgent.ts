/**
 * @file 高レベルなタスクを自律的に計画・実行するAIエージェント機能を提供します。
 * このバージョンは、Vercel AI SDKを利用してGoogle Gemini, Groq, OpenRouterを動的に切り替え可能です。
 * アーキテクチャを「ツール呼び出しモード」に移行し、信頼性と拡張性を向上させています。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { CoreMessage, LanguageModel, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";

import { AgentState } from "./agentState.js";
import { ReflectionResult, reflectionSchema } from "./types.js";
import { getBasePrompt } from "./prompts/base.js";
import { formatContext } from "./prompts/context.js";
import { getReflectionPrompt, formatReflection } from "./prompts/reflection.js";
import { toolRegistry, availableTools } from "./tools/index.js";

// LLMインスタンスを生成するヘルパー関数
function getLlmInstance(): LanguageModel {
    const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';
    if (LLM_PROVIDER === 'groq') {
        const groqApiKey = process.env.GROQ_API_KEY;
        if (!groqApiKey) throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
        const groq = createGroq({ apiKey: groqApiKey });
        return groq(process.env.GROQ_MODEL || '');
    } else if (LLM_PROVIDER === 'openrouter') {
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEYが.envファイルに設定されていません。");
        const openrouter = createOpenAI({
            apiKey: openRouterApiKey,
            baseURL: "https://openrouter.ai/api/v1",
            headers: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Stagehand Agent Console' }
        });
        return openrouter(process.env.OPENROUTER_MODEL || '');
    } else {
        const googleApiKey = process.env.GOOGLE_API_KEY;
        if (!googleApiKey) throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
        const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
        return google(process.env.GEMINI_MODEL || '');
    }
}

export async function taskAutomationAgent(task: string, stagehand: Stagehand) {
    const state = new AgentState(stagehand);
    const maxLoops = 15;
    const llm = getLlmInstance();

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
                    const tool = toolRegistry.get(toolCall.toolName);
                    if (!tool) throw new Error(`ツール "${toolCall.toolName}" が見つかりません。`);

                    console.log(`  ⚡️ 実行中: ${tool.name}(${JSON.stringify(toolCall.args)})`);
                    const result = await tool.execute(state, toolCall.args);
                    
                    // 結果がオブジェクトの場合は文字列化してログ表示
                    const resultLog = typeof result === 'object' ? JSON.stringify(result, null, 2) : result;
                    console.log(`  ✅ 成功: ${resultLog.substring(0, 200)}...`);
                    
                    return { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result };
                } catch (error: any) {
                    console.error(`  ❌ エラー (${toolCall.toolName}): ${error.message}`);
                    return { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, result: `エラー: ${error.message}` };
                }
            })
        );
        
        messages.push({ role: 'tool', content: toolResults.map(tr => ({ type: 'tool-result', toolCallId: tr.toolCallId, toolName: tr.toolName, result: tr.result })) });
        
        await state.updatePages();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.warn(`⚠️ 最大試行回数（${maxLoops}回）に達したため、処理を中断しました。`);
}
