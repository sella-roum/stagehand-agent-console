import { z } from "zod";
import { AgentState } from "../agentState.js";
import { actWithCache } from "../../utils.js";

export const cachedActSchema = z.object({
  instruction: z.string().describe("キャッシュを利用して実行する操作の自然言語指示。"),
});

export const cachedActTool = {
  name: "cached_act",
  description: "指示に対応する操作をキャッシュを利用して実行します。初めての操作は要素を探し、2回目以降は高速に実行します。",
  schema: cachedActSchema,
  execute: async (state: AgentState, { instruction }: z.infer<typeof cachedActSchema>): Promise<string> => {
    const page = state.getActivePage();
    await actWithCache(page, instruction);
    return `キャッシュを利用して操作 '${instruction}' を実行しました。`;
  },
};
