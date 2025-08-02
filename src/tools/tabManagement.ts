/**
 * @file ブラウザのマルチタブ操作に関するツールを定義します。
 * 新しいタブの作成、タブ間の切り替え、タブを閉じる機能を提供します。
 */

import { z } from "zod";
import { AgentState } from "../agentState.js";

// --- newTab Tool ---

/**
 * `new_tab`ツールの入力スキーマ。
 */
export const newTabSchema = z.object({
  url: z.string().describe("新しいタブで開くURL"),
});

/**
 * `new_tab`ツールの定義オブジェクト。
 */
export const newTabTool = {
  name: "new_tab",
  description: "新しいブラウザタブで指定されたURLを開きます。",
  schema: newTabSchema,
  /**
   * `new_tab`ツールを実行します。
   * @param state - 現在のエージェントの状態。
   * @param args - `newTabSchema`に基づいた引数。
   * @returns 新しいタブの作成成功メッセージ。
   */
  execute: async (state: AgentState, { url }: z.infer<typeof newTabSchema>): Promise<string> => {
    const page = state.getActivePage();
    const newPage = await page.context().newPage();
    await newPage.goto(url);
    // 新しいタブが開かれたので、AgentStateのページリストを更新する
    await state.updatePages();
    return `新しいタブで ${url} を開きました。`;
  },
};

// --- switchTab Tool ---

/**
 * `switch_tab`ツールの入力スキーマ。
 */
export const switchTabSchema = z.object({
  tabIndex: z.number().int().describe("切り替え先のタブのインデックス番号"),
});

/**
 * `switch_tab`ツールの定義オブジェクト。
 */
export const switchTabTool = {
  name: "switch_tab",
  description: "指定されたインデックスのタブに切り替えます。",
  schema: switchTabSchema,
  /**
   * `switch_tab`ツールを実行します。
   * @param state - 現在のエージェントの状態。
   * @param args - `switchTabSchema`に基づいた引数。
   * @returns タブの切り替え成功メッセージ。
   */
  execute: async (state: AgentState, { tabIndex }: z.infer<typeof switchTabSchema>): Promise<string> => {
    const targetPage = state.getPageAtIndex(tabIndex);
    await targetPage.bringToFront();
    // アクティブなタブが変更されたので、AgentStateの状態を更新する
    await state.updatePages();
    return `タブ ${tabIndex} に切り替えました。`;
  },
};

// --- closeTab Tool ---

/**
 * `close_tab`ツールの入力スキーマ。
 */
export const closeTabSchema = z.object({
  tabIndex: z.number().int().describe("閉じるタブのインデックス番号"),
});

/**
 * `close_tab`ツールの定義オブジェクト。
 */
export const closeTabTool = {
  name: "close_tab",
  description: "指定されたインデックスのタブを閉じます。",
  schema: closeTabSchema,
  /**
   * `close_tab`ツールを実行します。
   * @param state - 現在のエージェントの状態。
   * @param args - `closeTabSchema`に基づいた引数。
   * @returns タブを閉じた後の成功メッセージ。
   */
  execute: async (state: AgentState, { tabIndex }: z.infer<typeof closeTabSchema>): Promise<string> => {
    const pageToClose = state.getPageAtIndex(tabIndex);
    if (pageToClose && !pageToClose.isClosed()) {
      await pageToClose.close();
    }
    // タブが閉じられたので、AgentStateのページリストを更新する
    await state.updatePages();
    return `タブ ${tabIndex} を閉じました。`;
  },
};
