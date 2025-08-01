import { z } from "zod";
import { AgentState } from "../agentState.js";
import { CoreMessage, LanguageModel, streamText } from "ai";

// vision_analyze ツールの定義
export const visionAnalyzeSchema = z.object({
  question: z.string().describe("スクリーンショットについて尋ねる具体的な質問。例: '「送信」と書かれた青いボタンはどこにある？'"),
});

export const visionAnalyzeTool = {
  name: "vision_analyze",
  description: "現在のページのスクリーンショットを撮影し、視覚的な質問に答えます。DOMベースの操作で行き詰まった場合に使用します。",
  schema: visionAnalyzeSchema,
  execute: async (state: AgentState, { question }: z.infer<typeof visionAnalyzeSchema>, llm: LanguageModel): Promise<string> => {
    const page = state.getActivePage();
    const screenshotBuffer = await page.screenshot();
    const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;

    console.log("  ...📸 スクリーンショットを撮影し、視覚分析中...");

    const visionMessages: CoreMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image', image: new URL(screenshotDataUrl) },
        ],
      },
    ];

    const { text } = await streamText({
      model: llm,
      messages: visionMessages,
    });

    return `視覚分析の結果: ${text}`;
  },
};

// click_at_coordinates ツールの定義
export const clickAtCoordinatesSchema = z.object({
  x: z.number().describe("クリックするX座標"),
  y: z.number().describe("クリックするY座標"),
  reasoning: z.string().describe("なぜその座標をクリックするのかの簡潔な説明"),
});

export const clickAtCoordinatesTool = {
  name: "click_at_coordinates",
  description: "指定されたX, Y座標をマウスでクリックします。vision_analyzeの結果を基に使用します。",
  schema: clickAtCoordinatesSchema,
  execute: async (state: AgentState, { x, y, reasoning }: z.infer<typeof clickAtCoordinatesSchema>): Promise<string> => {
    console.log(`  ...🖱️ 座標 (${x}, ${y}) をクリックします。理由: ${reasoning}`);
    const page = state.getActivePage();
    await page.mouse.click(x, y);
    return `座標 (${x}, ${y}) をクリックしました。`;
  },
};
