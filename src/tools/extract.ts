import { z } from "zod";
import { AgentState } from "../agentState.js";

export const extractSchema = z.object({
  instruction: z.string().nullable().describe("抽出したい内容の指示。例: '記事のタイトル'。引数がない場合はページ全体のテキストを抽出します。"),
});

export const extractTool = {
  name: "extract",
  description: "現在のページから情報を抽出します。",
  schema: extractSchema,
  execute: async (state: AgentState, { instruction }: z.infer<typeof extractSchema>): Promise<any> => {
    const page = state.getActivePage();
    if (instruction) {
      return await page.extract(instruction);
    }
    return await page.extract();
  },
};
