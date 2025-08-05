/**
 * @file ブラウザのマルチタブ操作に関するツールを定義します。
 * 新しいタブの作成、タブ間の切り替え、タブを閉じる機能を提供します。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";
import { InvalidToolArgumentError, NavigationTimeoutError } from "@/src/errors";
import { PreconditionResult } from "@/src/types";

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
   * @param args.url
   * @returns 新しいタブの作成成功メッセージ。
   */
  execute: async (
    state: AgentState,
    args: z.infer<typeof newTabSchema>,
  ): Promise<string> => {
    const { url } = args;
    const page = state.getActivePage();
    const newPage = await page.context().newPage();
    try {
      await newPage.goto(url);
      // 新しいタブが開かれたので、AgentStateのページリストを更新する
      await state.updatePages();
      return `新しいタブで ${url} を開きました。`;
    } catch (error) {
      // 型安全なエラーハンドリング
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.message.includes("timeout"))
      ) {
        throw new NavigationTimeoutError(
          `新しいタブでのURLへの移動がタイムアウトしました: ${url}。`,
          "new_tab",
          args,
          url,
        );
      }
      throw error;
    }
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
   * switch_tabの事前条件チェック
   * @param state
   * @param args
   * @returns 事前条件の結果。成功した場合は { success: true }、失敗した場合は { success: false, message: string }。
   */
  precondition: async (
    state: AgentState,
    args: z.infer<typeof switchTabSchema>,
  ): Promise<PreconditionResult> => {
    const { tabIndex } = args;
    const tabs = await state.getTabInfo();
    if (tabs.length <= 1) {
      return {
        success: false,
        message: "切り替えるべき他のタブが存在しません。タブは1つだけです。",
      };
    }
    if (tabIndex < 0 || tabIndex >= tabs.length) {
      return {
        success: false,
        message: `無効なタブインデックスです: ${tabIndex}。利用可能なインデックスは 0 から ${
          tabs.length - 1
        } です。`,
      };
    }
    if (tabs[tabIndex].isActive) {
      return {
        success: false,
        message: `タブ ${tabIndex} は既にアクティブです。切り替える必要はありません。`,
      };
    }
    return { success: true };
  },
  /**
   * `switch_tab`ツールを実行します。
   * @param state - 現在のエージェントの状態。
   * @param args - `switchTabSchema`に基づいた引数。
   * @param args.tabIndex
   * @returns タブの切り替え成功メッセージ。
   */
  execute: async (
    state: AgentState,
    args: z.infer<typeof switchTabSchema>,
  ): Promise<string> => {
    const { tabIndex } = args;
    try {
      const targetPage = state.getPageAtIndex(tabIndex);
      await targetPage.bringToFront();
      // アクティブなタブが変更されたので、AgentStateの状態を更新する
      await state.updatePages();
      return `タブ ${tabIndex} に切り替えました。`;
    } catch (error) {
      // 型安全なエラーハンドリング
      throw new InvalidToolArgumentError(
        `タブの切り替えに失敗しました: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "switch_tab",
        args,
      );
    }
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
   * close_tabの事前条件チェック
   * @param state
   * @param args
   * @returns 事前条件の結果。成功した場合は { success: true }、失敗した場合は { success: false, message: string }。
   */
  precondition: async (
    state: AgentState,
    args: z.infer<typeof closeTabSchema>,
  ): Promise<PreconditionResult> => {
    const { tabIndex } = args;
    const tabs = await state.getTabInfo();
    if (tabs.length <= 1) {
      return {
        success: false,
        message: "最後のタブは閉じることができません。",
      };
    }
    if (tabIndex < 0 || tabIndex >= tabs.length) {
      return {
        success: false,
        message: `無効なタブインデックスです: ${tabIndex}。利用可能なインデックスは 0 から ${
          tabs.length - 1
        } です。`,
      };
    }
    return { success: true };
  },
  /**
   * `close_tab`ツールを実行します。
   * @param state - 現在のエージェントの状態。
   * @param args - `closeTabSchema`に基づいた引数。
   * @param args.tabIndex
   * @returns タブを閉じた後の成功メッセージ。
   */
  execute: async (
    state: AgentState,
    args: z.infer<typeof closeTabSchema>,
  ): Promise<string> => {
    const { tabIndex } = args;
    try {
      const pageToClose = state.getPageAtIndex(tabIndex);
      if (pageToClose && !pageToClose.isClosed()) {
        await pageToClose.close();
      }
      // タブが閉じられたので、AgentStateのページリストを更新する
      await state.updatePages();
      return `タブ ${tabIndex} を閉じました。`;
    } catch (error) {
      // 型安全なエラーハンドリング
      throw new InvalidToolArgumentError(
        `タブを閉じるのに失敗しました: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "close_tab",
        args,
      );
    }
  },
};
