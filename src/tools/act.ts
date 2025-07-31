import { z } from "zod";
import { AgentState } from "../agentState.js";
import { drawObserveOverlay, clearOverlays } from "../../utils.js";

export const actSchema = z.object({
  instruction: z.string().describe("実行する操作の自然言語による指示。例: '「ログイン」ボタンをクリック'"),
});

export const actTool = {
  name: "act",
  description: "ページ上で特定の操作（クリック、入力、スクロールなど）を行います。",
  schema: actSchema,
  execute: async (state: AgentState, { instruction }: z.infer<typeof actSchema>): Promise<string> => {
    const page = state.getActivePage();
    const observedForAct = await page.observe(instruction);
    
    if (observedForAct.length > 0) {
      console.log("  ...操作対象をハイライト表示します。");
      await drawObserveOverlay(page, observedForAct);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const result = await page.act(observedForAct[0]);
      await clearOverlays(page);
      return `操作 '${instruction}' を実行しました。結果: ${JSON.stringify(result)}`;
    } else {
      console.log("  ...observeで見つからなかったため、直接actを試みます。");
      const result = await page.act(instruction);
      return `操作 '${instruction}' を直接実行しました。結果: ${JSON.stringify(result)}`;
    }
  },
};
