import { z } from "zod";
import { AgentState } from "../agentState.js";

// --- newTab Tool ---
export const newTabSchema = z.object({
  url: z.string().describe("新しいタブで開くURL"),
});

export const newTabTool = {
  name: "new_tab",
  description: "新しいブラウザタブで指定されたURLを開きます。",
  schema: newTabSchema,
  execute: async (state: AgentState, { url }: z.infer<typeof newTabSchema>): Promise<string> => {
    const page = state.getActivePage();
    const newPage = await page.context().newPage();
    await newPage.goto(url);
    await state.updatePages();
    return `新しいタブで ${url} を開きました。`;
  },
};

// --- switchTab Tool ---
export const switchTabSchema = z.object({
  tabIndex: z.number().int().describe("切り替え先のタブのインデックス番号"),
});

export const switchTabTool = {
  name: "switch_tab",
  description: "指定されたインデックスのタブに切り替えます。",
  schema: switchTabSchema,
  execute: async (state: AgentState, { tabIndex }: z.infer<typeof switchTabSchema>): Promise<string> => {
    const targetPage = state.getPageAtIndex(tabIndex);
    await targetPage.bringToFront();
    await state.updatePages();
    return `タブ ${tabIndex} に切り替えました。`;
  },
};

// --- closeTab Tool ---
export const closeTabSchema = z.object({
  tabIndex: z.number().int().describe("閉じるタブのインデックス番号"),
});

export const closeTabTool = {
  name: "close_tab",
  description: "指定されたインデックスのタブを閉じます。",
  schema: closeTabSchema,
  execute: async (state: AgentState, { tabIndex }: z.infer<typeof closeTabSchema>): Promise<string> => {
    const pageToClose = state.getPageAtIndex(tabIndex);
    if (pageToClose && !pageToClose.isClosed()) {
      await pageToClose.close();
    }
    await state.updatePages();
    return `タブ ${tabIndex} を閉じました。`;
  },
};
