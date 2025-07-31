import { z } from "zod";
import { AgentState } from "../agentState.js";
import { LanguageModel, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";

export const summarizeSchema = z.object({
  textToSummarize: z.string().nullable().describe("要約するテキスト。nullの場合、現在のページ全体のテキストを対象とします。"),
});

export const summarizeTool = {
  name: "summarize",
  description: "現在のページ内容や指定されたテキストを要約します。",
  schema: summarizeSchema,
  execute: async (state: AgentState, { textToSummarize }: z.infer<typeof summarizeSchema>): Promise<string> => {
    let targetText = textToSummarize;
    if (!targetText) {
      const page = state.getActivePage();
      const extraction = await page.extract();
      targetText = extraction?.page_text || "";
    }

    if (!targetText) {
      return "要約対象のテキストがありません。";
    }

    const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';
    let llm: LanguageModel;
    // ... (LLMインスタンス化ロジックはtaskAutomationAgentからコピー)
    if (LLM_PROVIDER === 'groq') {
        const groqApiKey = process.env.GROQ_API_KEY;
        if (!groqApiKey) throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
        const groq = createGroq({ apiKey: groqApiKey });
        llm = groq(process.env.GROQ_MODEL || '');
    } else if (LLM_PROVIDER === 'openrouter') {
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEYが.envファイルに設定されていません。");
        const openrouter = createOpenAI({
          apiKey: openRouterApiKey,
          baseURL: "https://openrouter.ai/api/v1",
          headers: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Stagehand Agent Console' }
        });
        llm = openrouter(process.env.OPENROUTER_MODEL || '');
    } else {
        const googleApiKey = process.env.GOOGLE_API_KEY;
        if (!googleApiKey) throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
        const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
        llm = google(process.env.GEMINI_MODEL || '');
    }

    const { text } = await generateText({
        model: llm,
        prompt: `以下のテキストを日本語で簡潔に要約してください:\n\n${targetText.substring(0, 4000)}`
    });
    return text;
  },
};
