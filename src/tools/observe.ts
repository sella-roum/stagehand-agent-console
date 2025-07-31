import { z } from "zod";
import { AgentState } from "../agentState.js";
import { drawObserveOverlay, clearOverlays } from "../../utils.js";

export const observeSchema = z.object({
  instruction: z.string().nullable().describe("探したい要素の説明。例: 'すべてのボタン'。引数がない場合はページ上の主要な要素を観察します。"),
});

export const observeTool = {
  name: "observe",
  description: "現在のページ上の操作可能な要素を探します。",
  schema: observeSchema,
  execute: async (state: AgentState, { instruction }: z.infer<typeof observeSchema>): Promise<any> => {
    const page = state.getActivePage();
    const results = instruction ? await page.observe(instruction) : await page.observe();
    
    if (results.length > 0) {
      console.log("  ...観察対象をハイライト表示します。");
      await drawObserveOverlay(page, results);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await clearOverlays(page);
    }
    return results;
  },
};
