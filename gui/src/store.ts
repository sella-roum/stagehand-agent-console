/**
 * @file GUIアプリケーション全体の状態を管理するためのZustandストアを定義します。
 * このストアは、WebSocket経由でバックエンドから受信した情報を保持し、
 * Reactコンポーネントにリアクティブな状態を提供します。
 */

import { create } from "zustand";
import { LogPayload, TabInfo } from "../../types/protocol.js";
import { ToolCall } from "ai";

/**
 * GUIアプリケーションの状態の型定義。
 */
interface AppState {
  logs: LogPayload[];
  screenshot: string | null;
  currentUrl: string;
  tabs: TabInfo[];
  interventionMode: "autonomous" | "confirm" | "edit";
  planForApproval: ToolCall<string, any>[] | null;
  addLog: (log: LogPayload) => void;
  setScreenshot: (image: string) => void;
  setState: (state: {
    url: string;
    tabs: TabInfo[];
    interventionMode: "autonomous" | "confirm" | "edit";
  }) => void;
  setPlanForApproval: (plan: ToolCall<string, any>[]) => void;
  clearPlanForApproval: () => void;
}

/**
 * Zustandストアを作成します。
 * 各状態と、その状態を更新するためのアクションを定義します。
 */
export const useStore = create<AppState>((set) => ({
  // --- 初期状態 ---
  logs: [],
  screenshot: null,
  currentUrl: "about:blank",
  tabs: [],
  interventionMode: "confirm",
  planForApproval: null,

  // --- アクション ---
  /**
   * ログリストに新しいログを追加します。
   * @param log - 追加するログオブジェクト。
   * @returns void
   */
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),

  /**
   * 表示するスクリーンショットを更新します。
   * @param image - Base64エンコードされた画像文字列。
   * @returns void
   */
  setScreenshot: (image) => set({ screenshot: image }),

  /**
   * バックエンドから受信したエージェントの全体状態でUIの状態を更新します。
   * @param newState - 新しいエージェントの状態。
   * @returns void
   */
  setState: (newState) =>
    set({
      currentUrl: newState.url,
      tabs: newState.tabs,
      interventionMode: newState.interventionMode,
    }),

  /**
   * 承認待ちの計画をストアにセットします。
   * @param plan - 承認を待つ計画。
   * @returns void
   */
  setPlanForApproval: (plan) => set({ planForApproval: plan }),

  /**
   * 承認待ちの計画をクリアします。
   * @returns void
   */
  clearPlanForApproval: () => set({ planForApproval: null }),
}));
