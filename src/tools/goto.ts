import { z } from "zod";
import { AgentState } from "../agentState.js";

export const gotoSchema = z.object({
  url: z.string().describe("移動先の完全なURL"),
});

export const gotoTool = {
  name: "goto",
  description: "指定されたURLに現在のブラウザタブを移動させます。ページのナビゲーションに使用します。",
  schema: gotoSchema,
  execute: async (state: AgentState, { url }: z.infer<typeof gotoSchema>): Promise<string> => {
    const page = state.getActivePage();
    await page.goto(url);
    return `正常に ${url} に移動しました。`;
  },
};
